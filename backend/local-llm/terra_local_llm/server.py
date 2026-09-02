"""Local HF OpenAI-compatible model server."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

# Model id format: "<hf-repo>/<file>.gguf" (matches catalog.Entry.HFID).
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf"
MAX_OUTPUT_TOKENS = 4096

# llama.cpp defaults to n_ctx=512 and errors on overflow.
N_CTX = int(os.environ.get("TERRA_N_CTX") or 18432)
N_THREADS = int(os.environ.get("TERRA_N_THREADS") or 0) or max(
    1, (os.cpu_count() or 4) // 2
)

# Partial GPU offload. Override with TERRA_N_GPU_LAYERS (-1 = all, 0 = CPU).
_DEFAULT_GPU_LAYERS = 16


class _State:
    model_id: str = ""
    device: str = "cpu"
    model: Any = None
    loaded: bool = False
    loading: str = ""  # in-flight model_id; chat returns 503 until clear
    load_error: str = ""
    load_gen: int = 0  # bumped to discard cancelled/superseded loads


state = _State()

state_lock = threading.Lock()  # shared state
infer_lock = threading.Lock()  # llama.cpp is not thread-safe


def state_name() -> str:
    if state.loading:
        return "loading"
    if state.loaded:
        return "ready"
    if state.load_error:
        return "error"
    return "empty"


def pick_device(requested: str = "") -> str:
    """Resolve llama.cpp offload target."""
    requested = (requested or os.environ.get("TERRA_DEVICE") or "auto").lower()
    if requested != "auto":
        return requested
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "mps"  # Go reports "mps"; llama.cpp uses Metal
    # Keep in sync with catalog/host.go detectDevice.
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            if subprocess.run([nvidia_smi, "-L"], capture_output=True, timeout=5, check=False).returncode == 0:
                return "cuda"
        except (OSError, subprocess.SubprocessError):
            pass
    return "cpu"


def n_gpu_layers_for(device: str) -> int:
    """Layers to offload: 0 = CPU, -1 = all, else TERRA_N_GPU_LAYERS or the default."""
    raw = os.environ.get("TERRA_N_GPU_LAYERS")
    if raw is not None and str(raw).strip() != "":
        return int(raw)
    if device in ("mps", "metal", "cuda"):
        return _DEFAULT_GPU_LAYERS
    return 0


def _split_model_id(model_id: str) -> tuple[str, str]:
    """"org/repo/file.gguf" -> ("org/repo", "file.gguf")."""
    repo, _, filename = model_id.rpartition("/")
    if not filename.endswith(".gguf") or not repo:
        raise RuntimeError(
            f'model id "{model_id}" must be "<hf-repo>/<file>.gguf"'
        )
    return repo, filename


def load_model(model_id: str = "", device: str = "", gen: int | None = None) -> bool:
    """Download and install a GGUF. Returns False if gen is stale (cancelled or superseded)."""
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
    layers = n_gpu_layers_for(device)

    path = hf_hub_download(repo, filename)
    if gen is not None and gen != state.load_gen:  # cancelled during download
        return False

    model = Llama(
        model_path=path,
        n_ctx=N_CTX,
        n_gpu_layers=layers,
        n_threads=N_THREADS,
        n_threads_batch=N_THREADS,
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
    # Load failures must not exit: Compose would restart-loop on a bad TERRA_MODEL.
    try:
        load_model()
    except Exception as e:  # noqa: BLE001
        state.load_error = f"loading {os.environ.get('TERRA_MODEL') or DEFAULT_MODEL} failed: {e}"
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


@lru_cache(maxsize=8)
def _grammar_for(schema_text: str):
    """Compile JSON Schema to GBNF. Returns None on failure so inference still runs."""
    try:
        from llama_cpp import LlamaGrammar

        return LlamaGrammar.from_json_schema(schema_text, verbose=False)
    except Exception as e:  # noqa: BLE001
        print(f"grammar: falling back to prompt-only schema: {e}", file=sys.stderr)
        return None


def _schema_text(req: ChatCompletionRequest) -> str:
    """JSON Schema text from the request, or empty."""
    rf = req.response_format
    if rf and rf.type == "json_schema" and rf.json_schema and rf.json_schema.schema_:
        return json.dumps(rf.json_schema.schema_)
    return ""


def _messages_for_generate(req: ChatCompletionRequest) -> list[dict[str, str]]:
    msgs = [{"role": message.role, "content": message.content} for message in req.messages]
    schema_text = _schema_text(req)
    if schema_text:
        hint = (
            "Your reply must be a single JSON object and nothing else. "
            f"It must conform to this JSON Schema:\n{schema_text}"
        )
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
    with infer_lock:
        model = state.model
        if model is None:
            raise HTTPException(status_code=503, detail="model not loaded")
        schema_text = _schema_text(req)
        grammar = _grammar_for(schema_text) if schema_text else None
        out = model.create_chat_completion(
            messages=msgs,
            temperature=req.temperature or 0.0,
            max_tokens=max_new,
            grammar=grammar,
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
    """Current model and load state."""
    return {
        "model_id": state.loading or state.model_id,
        "device": state.device,
        "state": state_name(),
        "error": state.load_error,
    }


def _load_worker(model_id: str, gen: int) -> None:
    try:
        load_model(model_id, gen=gen)
    except Exception as e:  # noqa: BLE001
        with state_lock:
            if gen == state.load_gen:
                state.load_error = f"loading {model_id} failed: {e}"
                state.loaded = False
    finally:
        with state_lock:
            if gen == state.load_gen:
                state.loading = ""


@app.post("/admin/load")
def admin_load(req: LoadRequest) -> dict:
    """Switch the served model. Returns immediately; poll /admin/status."""
    model_id = (req.model_id or "").strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="model_id is required")
    with state_lock:
        if state.loading == model_id:
            return {"model_id": model_id, "state": "loading"}
        if state.loaded and state.model_id == model_id:
            if state.loading:
                state.load_gen += 1
                state.loading = ""
            return {"model_id": model_id, "state": "ready"}
        state.load_gen += 1
        gen = state.load_gen
        state.loading = model_id
        state.load_error = ""
    threading.Thread(target=_load_worker, args=(model_id, gen), daemon=True).start()
    return {"model_id": model_id, "state": "loading"}


@app.post("/admin/cancel")
def admin_cancel() -> dict:
    """Abandon the in-flight load. Download may finish; result is not installed."""
    with state_lock:
        cancelled = state.loading
        state.load_gen += 1
        state.loading = ""
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
