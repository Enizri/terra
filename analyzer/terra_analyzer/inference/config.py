"""OpenAI-compatible client config."""

import os

import httpx

DEFAULT_BASE_URL = "http://localhost:8020/v1"
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
MAX_OUTPUT_TOKENS = 4096
DEFAULT_READ_TIMEOUT = 600.0


def _read_timeout() -> float:
    raw = os.environ.get("TERRA_LLM_TIMEOUT") or ""
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_READ_TIMEOUT
    return value if value > 0 else DEFAULT_READ_TIMEOUT


class Config:
    """Chat Completions target. TERRA_LLM_URL may be bare host or already /v1."""

    def __init__(
        self,
        model: str = "",
        base_url: str = "",
        client: httpx.Client | None = None,
        api_key: str = "",
    ):
        raw = (base_url or os.environ.get("TERRA_LLM_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.base_url = raw if raw.endswith("/v1") else raw + "/v1"
        self.model = model or os.environ.get("TERRA_MODEL") or DEFAULT_MODEL
        # A per-request key (workspace picker) beats the operator's env key.
        key = (api_key or os.environ.get("TERRA_LLM_API_KEY") or "").strip()
        self.api_key = key
        self.api_key_set = bool(key)
        self.read_timeout = _read_timeout()
        if client is not None:
            self.client = client
        else:
            headers = {}
            if key:
                headers["Authorization"] = f"Bearer {key}"
            timeout = httpx.Timeout(connect=10.0, read=self.read_timeout, write=30.0, pool=10.0)
            self.client = httpx.Client(timeout=timeout, headers=headers)

    def auth_headers(self) -> dict[str, str]:
        """Per-request Authorization. The constructed client already carries
        this header, but an injected one (tests, per-request routing) does not,
        so every call site passes it explicitly."""
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
