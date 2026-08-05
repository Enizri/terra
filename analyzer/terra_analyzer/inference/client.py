"""OpenAI-compatible Chat Completions client (sole LLM wire protocol)."""

import httpx

from ..schema import DRAFT_SCHEMA
from .config import MAX_OUTPUT_TOKENS, Config


class LLMError(Exception):
    """Anything that should surface to the Go side as a legible 502 detail."""


def preflight(cfg: Config) -> None:
    """Fails early if the model server is unreachable or missing TERRA_MODEL."""
    hint = (
        f"start the local HF server with `make run-llm`, or set TERRA_LLM_URL "
        f"to an OpenAI-compatible /v1 endpoint"
    )
    try:
        resp = cfg.client.get(cfg.base_url + "/models")
    except httpx.HTTPError as e:
        raise LLMError(f"cannot reach a model server at {cfg.base_url}: {e}\n{hint}") from e

    if resp.status_code != 200:
        raise LLMError(
            f"cannot list models at {cfg.base_url}/models: {resp.status_code}: "
            f"{resp.text.strip()}\n{hint}"
        )

    try:
        listing = resp.json()
    except ValueError as e:
        raise LLMError(f"unexpected reply from the model server at {cfg.base_url}: {e}") from e

    have = [m.get("id", "") for m in listing.get("data") or []]
    for name in have:
        if name == cfg.model or name.removesuffix(":latest") == cfg.model:
            return
    if not have:
        # Some servers omit enumeration; try chat and fail there if needed.
        return
    raise LLMError(
        f'the server at {cfg.base_url} is serving {", ".join(have)}, not "{cfg.model}"\n'
        f"set TERRA_MODEL to one of those ids, or pass --model to terra"
    )


def chat(cfg: Config, msgs: list[dict], *, use_schema: bool = True) -> str:
    """POST /v1/chat/completions. Returns assistant message content."""
    body: dict = {
        "model": cfg.model,
        "messages": msgs,
        "stream": False,
        "temperature": 0,
        "max_tokens": MAX_OUTPUT_TOKENS,
    }
    if use_schema:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "terra_map",
                "strict": True,
                "schema": DRAFT_SCHEMA,
            },
        }

    try:
        resp = cfg.client.post(cfg.base_url + "/chat/completions", json=body)
    except httpx.HTTPError as e:
        raise LLMError(f"chat: {e}") from e
    if resp.status_code != 200:
        raise LLMError(f"chat: {resp.status_code}: {resp.text.strip()}")
    try:
        out = resp.json()
    except ValueError as e:
        raise LLMError(f"chat: unexpected reply: {e}") from e
    if out.get("error"):
        err = out["error"]
        detail = err.get("message", err) if isinstance(err, dict) else err
        raise LLMError(f"chat: {detail}")

    choices = out.get("choices") or []
    if not choices:
        raise LLMError(f"chat: model {cfg.model} returned no choices")
    content = (choices[0].get("message") or {}).get("content", "")
    reason = choices[0].get("finish_reason", "")

    if reason == "length":
        raise LLMError(
            f"model {cfg.model} hit the {MAX_OUTPUT_TOKENS}-token output limit and "
            f"its answer was cut off; ask for fewer components or raise MAX_OUTPUT_TOKENS"
        )
    if not content or not str(content).strip():
        raise LLMError(f"chat: model {cfg.model} returned an empty message")
    return content
