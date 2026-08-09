"""Local HF OpenAI-compatible model server."""

from __future__ import annotations

import json
import os
import platform
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

# Model ids are "<hf-repo>/<file>.gguf" — the repo alone is not enough, since
# some repos publish only a sharded quant and others publish several. Mirrors
# catalog.Entry.HFID on the Go side, which is also what /v1 requests carry.
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf"
MAX_OUTPUT_TOKENS = 4096

# Context window. llama.cpp defaults to 512 and raises on overflow rather
# than truncating, so this has to clear the worst case end to end. Measured
# against the prompt budgets in prompts/architecture.py: 8.1k tokens for a
# maxed-out prompt, and a strict retry re-sends the rejected answer (up to
# MAX_OUTPUT_TOKENS) plus a correction before asking for another one —
# 8.1k + 4k + 4k ≈ 16.5k. The KV cache at this size, not the weights, is what
# the host pays for beyond the file: roughly 1.4 GB on a 7B.
N_CTX = int(os.environ.get("TERRA_N_CTX") or 24576)


class _State:
    model_id: str = ""
    device: str = "cpu"
    model: Any = None
    loaded: bool = False
    # Set while a background load_model is running; the chat endpoints refuse
    # to serve until it clears, because the old weights are already gone.
    loading: str = ""
    load_error: str = ""
    # Bumped by /admin/cancel and by a superseding /admin/load. from_pretrained
    # cannot be interrupted, so a worker whose generation went stale throws its
    # weights away instead of installing them.
    load_gen: int = 0


state = _State()

# Serializes state transitions between request handlers and the loader thread.
state_lock = threading.Lock()


def state_name() -> str:
    if state.loading:
        return "loading"
    if state.loaded:
        return "ready"
    if state.load_error:
        return "error"
    return "empty"


def pick_device(requested: str = "") -> str:
    """Where llama.cpp should put the layers. No torch involved — the GGUF
    backend detects its own accelerator, so this only decides whether to
    offload at all."""
    requested = (requested or os.environ.get("TERRA_DEVICE") or "auto").lower()
    if requested != "auto":
        return requested
    if sys.platform == "darwin" and platform.machine() == "arm64":
        # "mps" is what Go's detectDevice reports and what TERRA_DEVICE is set
        # to across the stack; llama.cpp's own name for it is Metal.
        return "mps"
    return "cpu"


def _split_model_id(model_id: str) -> tuple[str, str]:
    """"org/repo/file.gguf" -> ("org/repo", "file.gguf")."""
    repo, _, filename = model_id.rpartition("/")
    if not filename.endswith(".gguf") or not repo:
        raise RuntimeError(
            f'model id "{model_id}" must be "<hf-repo>/<file>.gguf"'
        )
    return repo, filename


def load_model(model_id: str = "", device: str = "", gen: int | None = None) -> bool:
    """Downloads a GGUF quant and installs it as the served model. Returns
    False when gen went stale (cancelled or superseded) — nothing is
    installed then."""
    try:
        from huggingface_hub import hf_hub_download
        from llama_cpp import Llama
    except ImportError as e:
        raise RuntimeError(
            "llama-cpp-python and huggingface_hub are required for the local "
            "server; install with: pip install -e '.[local]'"
        ) from e

    model_id = model_id or os.environ.get("TERRA_MODEL") or DEFAULT_MODEL
    repo, filename = _split_model_id(model_id)
    device = pick_device(device)

    # Download and load are separate on purpose: the download is the long
    # part, and finishing it is what makes a cancel worth checking for.
    path = hf_hub_download(repo, filename)
    if gen is not None and gen != state.load_gen:
        return False

    # A quantized GGUF is mmapped, so nothing here allocates a second copy of
    # the weights the way a safetensors load did. n_gpu_layers=-1 offloads
    # every layer; on CPU llama.cpp runs the same file without one.
    model = Llama(
        model_path=path,
        n_ctx=N_CTX,
        n_gpu_layers=-1 if device in ("mps", "metal", "cuda") else 0,
        verbose=False,
    )

    with state_lock:
        if gen is not None and gen != state.load_gen:
            return False
        state.model_id = model_id
        state.device = device
        state.model = model
        state.loaded = True
        state.load_error = ""
    return True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield
    state.model = None
    state.loaded = False


app = FastAPI(title="terra-local-llm", lifespan=lifespan)


class ChatMessage(BaseModel):
    role: str
    content: str


class JsonSchemaFormat(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = "response"
    strict: bool = True
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")


class ResponseFormat(BaseModel):
    type: str = "text"
    json_schema: JsonSchemaFormat | None = None


class ChatCompletionRequest(BaseModel):
    model: str = ""
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float = 0
    max_tokens: int = MAX_OUTPUT_TOKENS
    response_format: ResponseFormat | None = None


def _ensure_loaded() -> None:
    if state.loading:
        raise HTTPException(status_code=503, detail=f"loading {state.loading}")
    if not state.loaded or state.model is None:
        raise HTTPException(status_code=503, detail=state.load_error or "model not loaded")


def _messages_for_generate(req: ChatCompletionRequest) -> list[dict[str, str]]:
    msgs = [{"role": message.role, "content": message.content} for message in req.messages]
    rf = req.response_format
    if rf and rf.type == "json_schema" and rf.json_schema and rf.json_schema.schema_:
        schema_text = json.dumps(rf.json_schema.schema_)
        hint = (
            "Your reply must be a single JSON object and nothing else. "
            f"It must conform to this JSON Schema:\n{schema_text}"
        )
        # Reinforce schema on the system turn (or prepend one).
        if msgs and msgs[0]["role"] == "system":
            msgs[0] = {
                "role": "system",
                "content": msgs[0]["content"] + "\n\n" + hint,
            }
        else:
            msgs.insert(0, {"role": "system", "content": hint})
    return msgs


def generate_chat(req: ChatCompletionRequest) -> tuple[str, str]:
    """Returns (content, finish_reason)."""
    _ensure_loaded()
    msgs = _messages_for_generate(req)
    max_new = min(req.max_tokens or MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS)
    # The chat template ships inside the GGUF, so llama.cpp formats the turns
    # itself — there is no separate tokenizer to keep in step with the weights.
    out = state.model.create_chat_completion(
        messages=msgs,
        temperature=req.temperature or 0.0,
        max_tokens=max_new,
    )
    choice = out["choices"][0]
    content = (choice["message"].get("content") or "").strip()
    return content, choice.get("finish_reason") or "stop"


@app.get("/")
def root() -> dict:
    return {"service": "terra-llm", "status": "ok", "loaded": state.loaded}


@app.get("/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "model": state.model_id,
        "device": state.device,
        "loaded": state.loaded,
    }


class LoadRequest(BaseModel):
    model_id: str


@app.get("/admin/status")
def admin_status() -> dict:
    """What the host is serving, and whether a switch is in flight."""
    return {
        "model_id": state.loading or state.model_id,
        "device": state.device,
        "state": state_name(),
        "error": state.load_error,
    }


def _load_worker(model_id: str, gen: int) -> None:
    try:
        load_model(model_id, gen=gen)
    except Exception as e:  # noqa: BLE001 — the message is the whole payload
        with state_lock:
            # A cancelled load's failure is nobody's problem, and its marker
            # belongs to whoever superseded it.
            if gen == state.load_gen:
                state.load_error = f"loading {model_id} failed: {e}"
                state.loaded = False
    finally:
        with state_lock:
            if gen == state.load_gen:
                state.loading = ""


@app.post("/admin/load")
def admin_load(req: LoadRequest) -> dict:
    """Switch the served weights. Returns immediately; poll /admin/status."""
    model_id = (req.model_id or "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")
    with state_lock:
        if state.loading == model_id:
            return {"model_id": model_id, "state": "loading"}
        if state.loaded and state.model_id == model_id:
            # Already serving what the caller wants. If a switch to something
            # else is in flight it must be abandoned, or it would overwrite
            # this model moments after we reported it ready.
            if state.loading:
                state.load_gen += 1
                state.loading = ""
            return {"model_id": model_id, "state": "ready"}
        # A different model supersedes whatever is in flight rather than 409ing:
        # a user who cancels and picks something smaller must not be stuck
        # behind the download they abandoned.
        state.load_gen += 1
        gen = state.load_gen
        # Set before unlocking: a concurrent request must see "loading".
        state.loading = model_id
        state.load_error = ""
        # state.loaded is deliberately left alone: the weights already in RAM
        # keep serving until the new ones are installed, so a switch that is
        # cancelled or fails does not strand a model that still works.
    threading.Thread(target=_load_worker, args=(model_id, gen), daemon=True).start()
    return {"model_id": model_id, "state": "loading"}


@app.post("/admin/cancel")
def admin_cancel() -> dict:
    """Abandon the load in flight. Bytes already downloading still finish —
    what this guarantees is that the result never becomes the active model."""
    with state_lock:
        cancelled = state.loading
        state.load_gen += 1
        state.loading = ""
        # The abandoned load's error is nobody's problem either; leaving it set
        # would report "error" forever with nothing in flight.
        state.load_error = ""
    return {"cancelled": cancelled, "state": state_name()}


@app.get("/v1/models")
def list_models() -> dict:
    _ensure_loaded()
    return {
        "object": "list",
        "data": [
            {
                "id": state.model_id,
                "object": "model",
                "owned_by": "terra-local",
            }
        ],
    }


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest) -> dict:
    if req.stream:
        raise HTTPException(status_code=400, detail="streaming is not supported yet")
    _ensure_loaded()
    if req.model and req.model != state.model_id:
        # Allow empty model; reject hard mismatches so preflight stays honest.
        raise HTTPException(
            status_code=404,
            detail=f'model "{req.model}" is not loaded (loaded: {state.model_id})',
        )

    try:
        content, finish = generate_chat(req)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"generation failed: {e}") from e

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": state.model_id,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": finish,
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
