"""Runtime item loop: turn cap, unknown tools, path escape (no live LLM)."""

import json

import httpx
import pytest
from terra_analyzer.inference.client import Turn
from terra_analyzer.inference.config import Config
from terra_analyzer.runtime import (
    DEFAULT_MAX_TURNS,
    PolicyError,
    arguments_escape,
    iter_loop,
    path_escapes,
    run_loop,
)
from terra_analyzer.runtime.loop import _check_tool

from .conftest import mock_client

ALLOWED = frozenset({"lookup_component", "retrieve_files", "read_snippet"})
TOOLS = [{
    "type": "function",
    "function": {
        "name": "lookup_component",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
    },
}]


def _cfg() -> Config:
    return Config(base_url="http://llm/v1", model="m", client=mock_client(lambda r: httpx.Response(500)))


def _text(content: str) -> Turn:
    return Turn(content=content, tool_calls=[], finish_reason="stop")


def _call(name: str, arguments: str = '{"query":"web"}', call_id: str = "c1") -> Turn:
    from terra_analyzer.inference.client import ToolCall

    return Turn(
        content="",
        tool_calls=[ToolCall(id=call_id, name=name, arguments=arguments)],
        finish_reason="tool_calls",
    )


def test_path_escapes_is_segment_aware():
    assert path_escapes("../etc/passwd")
    assert path_escapes("foo/../bar")
    assert path_escapes("..")
    assert not path_escapes("server/auth.go")
    assert not path_escapes("foo...bar")
    assert arguments_escape('{"path": "../secrets"}')
    assert not arguments_escape('{"path": "server/auth.go"}')


def test_run_loop_stops_on_final_text(monkeypatch):
    monkeypatch.setattr("terra_analyzer.runtime.loop.complete", lambda *a, **k: _text("the web app"))
    called = []

    def dispatch(name, arguments):
        called.append(name)
        return "[]"

    answer = run_loop(
        _cfg(), [{"role": "user", "content": "where is web?"}],
        tools=TOOLS, allowed=ALLOWED, dispatch=dispatch,
    )
    assert answer == "the web app"
    assert called == []


def test_run_loop_dispatches_then_answers(monkeypatch):
    turns = [_call("lookup_component"), _text("auth owns sessions")]

    def complete(cfg, items, tools=None, tool_choice=None):
        assert tools == TOOLS
        assert "response_format" not in (tools or {})
        return turns.pop(0)

    monkeypatch.setattr("terra_analyzer.runtime.loop.complete", complete)
    seen = []

    def dispatch(name, arguments):
        seen.append((name, json.loads(arguments)))
        return json.dumps([{"id": "auth"}])

    events = []
    answer = run_loop(
        _cfg(), [{"role": "user", "content": "sso?"}],
        tools=TOOLS, allowed=ALLOWED, dispatch=dispatch,
        on_event=lambda ev: events.append(ev),
    )
    assert answer == "auth owns sessions"
    assert seen == [("lookup_component", {"query": "web"})]
    assert events == [{"stage": "retrieve", "label": "lookup_component"}]


def test_iter_loop_emits_tool_stage_for_read_snippet(monkeypatch):
    turns = [
        _call("read_snippet", '{"path": "server/auth.go", "repo_url": "https://github.com/acme/notes"}'),
        _text("here is the file"),
    ]
    monkeypatch.setattr("terra_analyzer.runtime.loop.complete", lambda *a, **k: turns.pop(0))
    events = list(iter_loop(
        _cfg(), [{"role": "user", "content": "q"}],
        tools=TOOLS, allowed=ALLOWED, dispatch=lambda n, a: "{}",
    ))
    assert events[0] == {"stage": "tool", "label": "read_snippet"}
    assert events[-1] == {"answer": "here is the file"}


def test_turn_cap_rejects_overflow(monkeypatch):
    monkeypatch.setattr(
        "terra_analyzer.runtime.loop.complete",
        lambda *a, **k: _call("lookup_component", call_id="c"),
    )
    with pytest.raises(PolicyError, match="turn overflow"):
        run_loop(
            _cfg(), [{"role": "user", "content": "q"}],
            tools=TOOLS, allowed=ALLOWED, dispatch=lambda n, a: "[]",
            max_turns=2,
        )


def test_default_max_turns_is_six():
    assert DEFAULT_MAX_TURNS == 6


def test_unknown_tool_rejected_before_dispatch(monkeypatch):
    monkeypatch.setattr(
        "terra_analyzer.runtime.loop.complete",
        lambda *a, **k: _call("run_shell", '{"cmd": "ls"}'),
    )
    called = []
    with pytest.raises(PolicyError, match="unknown tool"):
        run_loop(
            _cfg(), [{"role": "user", "content": "q"}],
            tools=TOOLS, allowed=ALLOWED,
            dispatch=lambda n, a: called.append(n) or "",
        )
    assert called == []


def test_dotdot_rejected_before_dispatch(monkeypatch):
    monkeypatch.setattr(
        "terra_analyzer.runtime.loop.complete",
        lambda *a, **k: _call("read_snippet", '{"path": "../etc/passwd", "repo_url": "https://github.com/acme/notes"}'),
    )
    called = []
    with pytest.raises(PolicyError, match="path escapes"):
        run_loop(
            _cfg(), [{"role": "user", "content": "q"}],
            tools=TOOLS, allowed=ALLOWED,
            dispatch=lambda n, a: called.append(n) or "",
        )
    assert called == []


def test_check_tool_rejects_apply_patch():
    with pytest.raises(PolicyError, match="unknown tool"):
        _check_tool("apply_patch", "{}", ALLOWED)
