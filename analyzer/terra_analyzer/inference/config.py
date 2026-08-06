"""OpenAI-compatible client config."""

import os

import httpx

DEFAULT_BASE_URL = "http://localhost:8020/v1"
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
MAX_OUTPUT_TOKENS = 4096


class Config:
    """Chat Completions target. TERRA_LLM_URL may be bare host or already /v1."""

    def __init__(
        self,
        model: str = "",
        base_url: str = "",
        client: httpx.Client | None = None,
    ):
        raw = (base_url or os.environ.get("TERRA_LLM_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.base_url = raw if raw.endswith("/v1") else raw + "/v1"
        self.model = model or os.environ.get("TERRA_MODEL") or DEFAULT_MODEL
        self.client = client or httpx.Client(timeout=900)
