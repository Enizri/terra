"""Replay recorded Completions turns through the item loop. No live LLM."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

from ..inference.client import ToolCall, Turn
from ..inference.config import Config
from ..runtime import iter_loop


def fixtures_dir() -> Path:
    return Path(__file__).resolve().parent / "fixtures"


def load_turns(name: str) -> list[Turn]:
    payload = json.loads((fixtures_dir() / name).read_text())
    raw = payload.get("turns") if isinstance(payload, dict) else payload
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{name} must contain a non-empty turns array")
    turns: list[Turn] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        calls = []
        for tc in item.get("tool_calls") or []:
            if not isinstance(tc, dict):
                continue
            calls.append(ToolCall(
                id=str(tc.get("id") or "c"),
                name=str(tc.get("name") or ""),
                arguments=str(tc.get("arguments") or "{}"),
            ))
        turns.append(Turn(
            content=str(item.get("content") or ""),
            tool_calls=calls,
            finish_reason=str(item.get("finish_reason") or ""),
        ))
    return turns


def replay(
    turns: list[Turn],
    *,
    tools: list[dict[str, Any]],
    allowed: frozenset[str],
    dispatch: Any = None,
) -> tuple[list[str], str]:
    """Return (tool names in order, final answer). Uses recorded turns only."""
    remaining = list(turns)

    def complete(cfg, items, tools=None, tool_choice=None):
        if not remaining:
            raise AssertionError("recorded Completions turns exhausted")
        return remaining.pop(0)

    called: list[str] = []

    def _dispatch(name: str, arguments: str) -> str:
        called.append(name)
        if dispatch is not None:
            return dispatch(name, arguments)
        return "{}"

    with patch("terra_analyzer.runtime.loop.complete", complete):
        events = list(iter_loop(
            Config(base_url="http://recorded/v1", model="recorded"),
            [{"role": "user", "content": "recorded"}],
            tools=tools,
            allowed=allowed,
            dispatch=_dispatch,
        ))

    answer = ""
    for event in events:
        if "answer" in event and "stage" not in event:
            answer = str(event["answer"])
    return called, answer
