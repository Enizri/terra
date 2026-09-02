"""Bounded Completions item loop: dispatch allowlisted tools or stop."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

from ..inference.client import Turn, complete
from ..inference.config import Config

DEFAULT_MAX_TURNS = 6
RETRIEVE_TOOLS = frozenset({"lookup_component", "retrieve_files"})


class PolicyError(Exception):
    """Unknown tool, path escape, or turn overflow."""


Dispatch = Callable[[str, str], str]
OnEvent = Callable[[dict[str, str]], None]


def path_escapes(value: str) -> bool:
    """True when a path-like string contains a `..` segment."""
    normalized = (value or "").replace("\\", "/")
    return any(part == ".." for part in normalized.split("/"))


def arguments_escape(arguments: str) -> bool:
    """True when any string argument (or the raw JSON) contains `..`."""
    raw = arguments or ""
    if path_escapes(raw):
        return True
    try:
        parsed = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return False
    if isinstance(parsed, dict):
        return any(isinstance(v, str) and path_escapes(v) for v in parsed.values())
    if isinstance(parsed, str):
        return path_escapes(parsed)
    return False


def _tool_calls_payload(turn: Turn) -> list[dict[str, Any]]:
    return [
        {
            "id": tc.id,
            "type": "function",
            "function": {"name": tc.name, "arguments": tc.arguments},
        }
        for tc in turn.tool_calls
    ]


def _check_tool(name: str, arguments: str, allowed: frozenset[str]) -> None:
    if name not in allowed:
        raise PolicyError(f'unknown tool "{name}"')
    if arguments_escape(arguments):
        raise PolicyError("path escapes the repository")


def iter_loop(
    cfg: Config,
    items: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None,
    allowed: frozenset[str],
    dispatch: Dispatch,
    max_turns: int = DEFAULT_MAX_TURNS,
) -> Iterator[dict[str, Any]]:
    """Yield `{stage, label}` events, then a final `{answer}`.

    Each turn is one `complete()` call. Tool calls are dispatched in order;
    final text or the turn cap ends the loop. Does not mutate `items`.
    """
    if max_turns < 1:
        raise PolicyError("turn overflow")
    conversation = list(items)
    for _ in range(max_turns):
        turn = complete(cfg, conversation, tools=tools)
        if turn.tool_calls:
            conversation.append({
                "role": "assistant",
                "content": turn.content or None,
                "tool_calls": _tool_calls_payload(turn),
            })
            for tc in turn.tool_calls:
                _check_tool(tc.name, tc.arguments, allowed)
                stage = "retrieve" if tc.name in RETRIEVE_TOOLS else "tool"
                yield {"stage": stage, "label": tc.name}
                result = dispatch(tc.name, tc.arguments)
                conversation.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })
            continue
        text = (turn.content or "").strip()
        if text:
            yield {"answer": text}
            return
        raise PolicyError("turn overflow")
    raise PolicyError("turn overflow")


def run_loop(
    cfg: Config,
    items: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None,
    allowed: frozenset[str],
    dispatch: Dispatch,
    max_turns: int = DEFAULT_MAX_TURNS,
    on_event: OnEvent | None = None,
) -> str:
    """Run `iter_loop` and return the final answer text."""
    answer = ""
    for event in iter_loop(
        cfg, items, tools=tools, allowed=allowed, dispatch=dispatch, max_turns=max_turns,
    ):
        if "answer" in event and "stage" not in event:
            answer = str(event["answer"])
            continue
        if on_event is not None:
            on_event({"stage": str(event.get("stage") or ""), "label": str(event.get("label") or "")})
    return answer
