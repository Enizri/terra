"""OpenAI-compatible Chat Completions client."""

import json
from urllib.parse import urlparse

import httpx

from ..schema import DRAFT_SCHEMA
from .config import MAX_OUTPUT_TOKENS, Config


class LLMError(Exception):
    """Surfaces to Go as a 502 detail."""


def _is_local(cfg: Config) -> bool:
    """Whether the request goes to this host's own sidecar. The same hostname
    check app.py's lifespan makes, plus the Compose `llm` service; base_url is
    always normalized to /v1, so parsing it is reliable."""
    return urlparse(cfg.base_url).hostname in ("localhost", "127.0.0.1", "llm")


def preflight(cfg: Config) -> None:
    """Fail if the model server is unreachable or not serving cfg.model."""
    # These reach the browser verbatim, so they must name the place the
    # request actually went — telling a hosted-provider user to run
    # `make run-llm` is worse than saying nothing.
    if _is_local(cfg):
        hint = (
            "start the local HF server with `make run-llm`, or set TERRA_LLM_URL "
            "to an OpenAI-compatible /v1 endpoint"
        )
    else:
        hint = (
            "the provider is unreachable, or the API key or model is not valid "
            "for it — re-enter the key, or choose another model"
        )
    try:
        resp = cfg.client.get(cfg.base_url + "/models", headers=cfg.auth_headers())
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

    have = [entry.get("id", "") for entry in listing.get("data") or []]
    for name in have:
        if name == cfg.model or name.removesuffix(":latest") == cfg.model:
            return
    if not have:
        # Some servers omit enumeration; try chat and fail there if needed.
        return
    if _is_local(cfg):
        fix = "set TERRA_MODEL to one of those ids, or pass --model to terra"
    else:
        fix = "choose another model"
    raise LLMError(
        f'the server at {cfg.base_url} is serving {", ".join(have)}, not "{cfg.model}"\n{fix}'
    )


# Base URLs whose provider rejected response_format json_schema with a 400;
# they skip straight to the json_object fallback on later calls.
_schema_unsupported: set[str] = set()


def _body(cfg: Config, msgs: list[dict], mode: str) -> dict:
    """mode: "schema" | "json_object" | "none". Never mutates msgs."""
    body: dict = {
        "model": cfg.model,
        "messages": msgs,
        "stream": False,
        "temperature": 0,
        "max_tokens": MAX_OUTPUT_TOKENS,
    }
    if mode == "schema":
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "terra_map",
                "strict": True,
                "schema": DRAFT_SCHEMA,
            },
        }
    elif mode == "json_object":
        body["response_format"] = {"type": "json_object"}
        body["messages"] = msgs + [{
            "role": "system",
            "content": "Reply with one JSON object matching exactly this JSON Schema "
                       "and nothing else:\n" + json.dumps(DRAFT_SCHEMA),
        }]
    return body


def _provider_error(cfg: Config, resp: httpx.Response) -> LLMError:
    """One dialect for provider failures: status, endpoint, model, message."""
    msg = resp.text.strip()
    try:
        parsed = resp.json()
        detail = (parsed.get("error") or {}).get("message")
        if detail:
            msg = str(detail)
    except ValueError:
        pass
    return LLMError(
        f"llm provider {resp.status_code} at {cfg.base_url} (model {cfg.model}): {msg[:400]}"
    )


def _post(cfg: Config, body: dict) -> httpx.Response:
    try:
        return cfg.client.post(
            cfg.base_url + "/chat/completions", json=body, headers=cfg.auth_headers()
        )
    except httpx.ReadTimeout as e:
        raise LLMError(
            f"llm timed out after {cfg.read_timeout:.0f}s waiting for {cfg.model} at "
            f"{cfg.base_url}; raise TERRA_LLM_TIMEOUT or use a faster model"
        ) from e
    except httpx.ConnectError as e:
        raise LLMError(f"cannot connect to {cfg.base_url}: {e}") from e
    except httpx.HTTPError as e:
        raise LLMError(f"chat: {e}") from e


def chat(cfg: Config, msgs: list[dict], *, use_schema: bool = True) -> str:
    """POST /v1/chat/completions. Returns assistant message content."""
    mode = "schema" if use_schema else "none"
    if mode == "schema" and cfg.base_url in _schema_unsupported:
        mode = "json_object"

    resp = _post(cfg, _body(cfg, msgs, mode))
    if resp.status_code == 400 and mode == "schema":
        # Provider rejects strict json_schema: retry once with json_object
        # and the schema embedded in the prompt; validation downstream is
        # unchanged and still gates the result.
        _schema_unsupported.add(cfg.base_url)
        resp = _post(cfg, _body(cfg, msgs, "json_object"))
    if resp.status_code != 200:
        raise _provider_error(cfg, resp)
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
