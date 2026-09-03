"""Policy evals: path escape, turn cap, tool allowlist. Recorded Completions only."""

import pytest

from terra_analyzer.evals.trajectory import replay
from terra_analyzer.inference.client import ToolCall, Turn
from terra_analyzer.runtime import DEFAULT_MAX_TURNS, PolicyError
from terra_analyzer.tools import EDITOR_TOOL_NAMES, GUIDE_TOOL_NAMES, GUIDE_TOOLS


def _call(name: str, arguments: str, call_id: str = "c1") -> Turn:
    return Turn(
        content="",
        tool_calls=[ToolCall(id=call_id, name=name, arguments=arguments)],
        finish_reason="tool_calls",
    )


def test_guide_allowlist_excludes_write_tools():
    assert "apply_patch" not in GUIDE_TOOL_NAMES
    assert "preview_restart" not in GUIDE_TOOL_NAMES
    assert "lookup_component" in GUIDE_TOOL_NAMES
    assert "apply_patch" in EDITOR_TOOL_NAMES
    assert "preview_restart" in EDITOR_TOOL_NAMES


def test_path_escape_rejected_before_dispatch():
    called: list[str] = []
    with pytest.raises(PolicyError, match="path escapes"):
        replay(
            [_call("read_snippet", '{"path": "../etc/passwd", "repo_url": "https://github.com/acme/notes"}')],
            tools=GUIDE_TOOLS,
            allowed=frozenset(GUIDE_TOOL_NAMES),
            dispatch=lambda n, a: called.append(n) or "{}",
        )
    assert called == []


def test_default_turn_cap_is_six():
    assert DEFAULT_MAX_TURNS == 6


def test_turn_cap_rejects_overflow():
    turns = [
        _call("lookup_component", '{"query": "web"}', call_id=f"c{i}")
        for i in range(3)
    ]
    with pytest.raises(PolicyError, match="turn overflow"):
        replay(
            turns,
            tools=GUIDE_TOOLS,
            allowed=frozenset(GUIDE_TOOL_NAMES),
            max_turns=2,
        )
