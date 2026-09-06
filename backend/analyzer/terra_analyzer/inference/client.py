"""OpenAI-compatible Chat Completions client."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from .config import MAX_OUTPUT_TOKENS, Config


class LLMError(Exception):
    """Surfaces to Go as a 502 detail."""


@dataclass
class ToolCall:
    """One Completions function call, already parsed off the wire."""

    id: str
    name: str
    arguments: str


@dataclass
class Turn:
    """One model step: text, tool calls, or both."""

    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str = ""


def _draft_schema():
    # Lazy: avoid circular import with tasks.architecture → inference.client.
    from ..tasks.architecture.schema import DRAFT_SCHEMA

    return DRAFT_SCHEMA


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
                "schema": _draft_schema(),
            },
        }
    elif mode == "json_object":
        body["response_format"] = {"type": "json_object"}
        body["messages"] = msgs + [{
            "role": "system",
            "content": "Reply with one JSON object matching exactly this JSON Schema "
                       "and nothing else:\n" + json.dumps(_draft_schema()),
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


def _arguments_json(value: Any) -> str:
    if value is None:
        return "{}"
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _block_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for part in value:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(str(part.get("text") or part.get("content") or ""))
        return "".join(parts)
    return str(value)


def _function_tool_call(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id") or item.get("call_id") or "",
        "type": "function",
        "function": {
            "name": item.get("name") or "",
            "arguments": _arguments_json(item.get("input") if "input" in item else item.get("arguments")),
        },
    }


def _tool_result_message(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": "tool",
        "tool_call_id": item.get("tool_use_id") or item.get("call_id") or item.get("id") or item.get("tool_call_id") or "",
        "content": _block_text(item.get("content") if "content" in item else item.get("output")),
    }


def _flatten_blocks(role: str, blocks: list[Any]) -> list[dict[str, Any]]:
    """Anthropic content blocks → Completions messages."""
    texts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for block in blocks:
        if isinstance(block, str):
            texts.append(block)
            continue
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype in ("text", "output_text", "input_text") or btype is None and "text" in block:
            texts.append(str(block.get("text") or ""))
        elif btype in ("tool_use", "function_call"):
            tool_calls.append(_function_tool_call(block))
        elif btype in ("tool_result", "function_call_output"):
            results.append(_tool_result_message(block))
        else:
            texts.append(_block_text(block.get("text") or block.get("content")))
    messages: list[dict[str, Any]] = []
    if texts or tool_calls:
        msg: dict[str, Any] = {"role": role}
        msg["content"] = "".join(texts) if texts else (None if tool_calls else "")
        if tool_calls:
            msg["tool_calls"] = tool_calls
        messages.append(msg)
    messages.extend(results)
    return messages


def _flatten_item(item: dict[str, Any]) -> list[dict[str, Any]]:
    """One Anthropic/Responses item → one or more Completions messages."""
    kind = item.get("type")
    if kind == "function_call":
        return [{
            "role": "assistant",
            "content": None,
            "tool_calls": [_function_tool_call(item)],
        }]
    if kind == "function_call_output":
        return [_tool_result_message(item)]
    if kind == "message":
        item = {
            "role": item.get("role") or "user",
            "content": item.get("content"),
            **({k: item[k] for k in ("tool_calls", "tool_call_id") if k in item}),
        }
    elif kind and "role" not in item:
        return []

    role = item.get("role") or "user"
    content = item.get("content")

    if role == "tool" or item.get("tool_call_id"):
        return [{
            "role": "tool",
            "tool_call_id": item.get("tool_call_id") or "",
            "content": _block_text(content),
        }]

    if item.get("tool_calls"):
        msg: dict[str, Any] = {"role": role, "tool_calls": list(item["tool_calls"])}
        if isinstance(content, list):
            msg["content"] = "".join(
                b if isinstance(b, str) else str((b or {}).get("text") or "")
                for b in content
            ) or None
        else:
            msg["content"] = content
        return [msg]

    if isinstance(content, list):
        return _flatten_blocks(role, content)

    return [{"role": role, "content": "" if content is None else content}]


def _flatten_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert internal items to Chat Completions messages. Does not mutate items."""
    messages: list[dict[str, Any]] = []
    for item in items:
        for msg in _flatten_item(item):
            prev = messages[-1] if messages else None
            if (
                prev
                and msg.get("role") == "assistant"
                and msg.get("tool_calls")
                and not (msg.get("content") or "")
                and prev.get("role") == "assistant"
                and prev.get("tool_calls")
                and not (prev.get("content") or "")
            ):
                prev["tool_calls"] = list(prev["tool_calls"]) + list(msg["tool_calls"])
            else:
                messages.append(msg)
    return messages


def _parse_tool_calls(raw: Any) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for tc in raw or []:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        calls.append(ToolCall(
            id=str(tc.get("id") or ""),
            name=str(fn.get("name") or tc.get("name") or ""),
            arguments=_arguments_json(fn.get("arguments") if "arguments" in fn else tc.get("arguments")),
        ))
    return calls


# Hermes/Qwen tool-call syntax. Servers that render `tools` through the model's
# own chat template (llama.cpp, and this repo's GGUF sidecar) hand the reply back
# verbatim, so the call arrives as text instead of in `message.tool_calls`.
_TOOL_CALL_BLOCK = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)


def _loads_object(raw: str) -> dict[str, Any] | None:
    """Parse one JSON object, tolerating the doubled braces some chat
    templates emit around a tool call ({{"name": ...}})."""
    text = (raw or "").strip()
    for candidate in (text, text[1:-1] if text.startswith("{{") and text.endswith("}}") else ""):
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _text_tool_calls(content: str) -> list[ToolCall]:
    """Tool calls the model wrote into its message text.

    Without this the agent loop reads a `<tool_call>` block as the final
    answer and hands the user raw XML instead of running the tool.
    """
    calls: list[ToolCall] = []
    for index, block in enumerate(_TOOL_CALL_BLOCK.findall(content)):
        parsed = _loads_object(block)
        if parsed is None:
            continue
        name = str(parsed.get("name") or "")
        if not name:
            continue
        raw_args = parsed["arguments"] if "arguments" in parsed else parsed.get("parameters")
        calls.append(ToolCall(id=f"text_{index}", name=name, arguments=_arguments_json(raw_args)))
    return calls


def complete(
    cfg: Config,
    items: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: Any = None,
) -> Turn:
    """POST /v1/chat/completions with optional tools. Flattening stays in inference."""
    msgs = _flatten_items(items)
    body: dict[str, Any] = {
        "model": cfg.model,
        "messages": msgs,
        "stream": False,
        "temperature": 0,
        "max_tokens": MAX_OUTPUT_TOKENS,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto" if tool_choice is None else tool_choice
    elif tool_choice is not None:
        body["tool_choice"] = tool_choice

    resp = _post(cfg, body)
    if resp.status_code != 200:
        raise _provider_error(cfg, resp)
    try:
        out = resp.json()
    except ValueError as e:
        raise LLMError(f"complete: unexpected reply: {e}") from e
    if out.get("error"):
        err = out["error"]
        detail = err.get("message", err) if isinstance(err, dict) else err
        raise LLMError(f"complete: {detail}")

    choices = out.get("choices") or []
    if not choices:
        raise LLMError(f"complete: model {cfg.model} returned no choices")
    message = choices[0].get("message") or {}
    raw_content = message.get("content")
    content = "" if raw_content is None else str(raw_content)
    tool_calls = _parse_tool_calls(message.get("tool_calls"))
    reason = choices[0].get("finish_reason") or ""
    if tools and not tool_calls:
        # Only when tools were offered: a `<tool_call>` block in a toolless
        # reply is the model quoting, not calling.
        tool_calls = _text_tool_calls(content)
        if tool_calls:
            # The server saw plain text and said "stop"; the turn is a call.
            content = _TOOL_CALL_BLOCK.sub("", content).strip()
            reason = "tool_calls"
    if tool_calls and not reason:
        reason = "tool_calls"
    if not content.strip() and not tool_calls:
        raise LLMError(f"complete: model {cfg.model} returned an empty message")
    return Turn(content=content, tool_calls=tool_calls, finish_reason=reason)
