"""Local HF OpenAI-compatible model server."""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
MAX_OUTPUT_TOKENS = 4096


class _State:
    model_id: str = ""
    device: str = "cpu"
    tokenizer: Any = None
    model: Any = None
    loaded: bool = False


state = _State()


def pick_device(requested: str = "") -> str:
    requested = (requested or os.environ.get("TERRA_DEVICE") or "auto").lower()
    if requested != "auto":
        return requested
    try:
        import torch
    except ImportError as e:
        raise RuntimeError(
            "torch is required for the local HF server; "
            "install with: pip install -e '.[local]'"
        ) from e
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model(model_id: str = "", device: str = "") -> None:
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as e:
        raise RuntimeError(
            "transformers and torch are required for the local HF server; "
            "install with: pip install -e '.[local]'"
        ) from e

    model_id = model_id or os.environ.get("TERRA_MODEL") or DEFAULT_MODEL
    device = pick_device(device)
    dtype = torch.float16 if device in ("cuda", "mps") else torch.float32

    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=dtype,
        trust_remote_code=True,
    )
    model.to(device)
    model.eval()

    state.model_id = model_id
    state.device = device
    state.tokenizer = tokenizer
    state.model = model
    state.loaded = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield
    state.model = None
    state.tokenizer = None
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
    if not state.loaded or state.model is None or state.tokenizer is None:
        raise HTTPException(status_code=503, detail="model not loaded")


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
    import torch

    _ensure_loaded()
    tokenizer = state.tokenizer
    model = state.model
    device = state.device

    msgs = _messages_for_generate(req)
    prompt = tokenizer.apply_chat_template(
        msgs, tokenize=False, add_generation_prompt=True
    )
    inputs = tokenizer(prompt, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    prompt_len = inputs["input_ids"].shape[-1]

    max_new = min(req.max_tokens or MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS)
    do_sample = req.temperature is not None and req.temperature > 0
    gen_kwargs: dict[str, Any] = {
        "max_new_tokens": max_new,
        "do_sample": do_sample,
        "pad_token_id": tokenizer.eos_token_id,
    }
    if do_sample:
        gen_kwargs["temperature"] = max(req.temperature, 1e-5)

    with torch.no_grad():
        out = model.generate(**inputs, **gen_kwargs)

    new_tokens = out[0][prompt_len:]
    content = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
    finish = "length" if len(new_tokens) >= max_new else "stop"
    return content, finish


@app.get("/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "model": state.model_id,
        "device": state.device,
        "loaded": state.loaded,
    }


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
