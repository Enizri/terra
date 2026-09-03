"""complete() flattening and Completions tool_calls parsing (no live LLM)."""

import json

import httpx
import pytest
from terra_analyzer.inference.client import (
    LLMError,
    _flatten_items,
    chat,
    complete,
)
from terra_analyzer.inference.config import Config

from .conftest import DEFAULT_MODEL, mock_client

LOOKUP = {
    "type": "function",
    "function": {
        "name": "lookup_component",
        "description": "Find a map component",
        "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
    },
}


def _cfg(handler) -> Config:
    return Config(base_url="http://llm/v1", model=DEFAULT_MODEL, client=mock_client(handler))


def _completion(message: dict, finish_reason: str = "stop") -> dict:
    return {"choices": [{"message": message, "finish_reason": finish_reason}]}


def test_flatten_plain_messages_pass_through():
    items = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "hi"},
    ]
    assert _flatten_items(items) == items
    assert items[1]["content"] == "hi"


def test_flatten_anthropic_tool_use_and_result():
    items = [
        {"role": "user", "content": "where is web?"},
        {"role": "assistant", "content": [
            {"type": "text", "text": "I'll look."},
            {"type": "tool_use", "id": "call_1", "name": "lookup_component", "input": {"q": "web"}},
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "call_1", "content": "the web app"},
        ]},
    ]
    snapshot = json.loads(json.dumps(items))
    msgs = _flatten_items(items)
    assert items == snapshot
    assert msgs[0] == {"role": "user", "content": "where is web?"}
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == "I'll look."
    assert msgs[1]["tool_calls"][0]["id"] == "call_1"
    assert msgs[1]["tool_calls"][0]["function"]["name"] == "lookup_component"
    assert json.loads(msgs[1]["tool_calls"][0]["function"]["arguments"]) == {"q": "web"}
    assert msgs[2] == {"role": "tool", "tool_call_id": "call_1", "content": "the web app"}


def test_flatten_responses_function_call_and_output():
    items = [
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "where is web?"}]},
        {"type": "function_call", "call_id": "call_1", "name": "lookup_component", "arguments": '{"q":"web"}'},
        {"type": "function_call", "call_id": "call_2", "name": "retrieve_files", "arguments": '{"q":"app"}'},
        {"type": "function_call_output", "call_id": "call_1", "output": "the web app"},
    ]
    msgs = _flatten_items(items)
    assert msgs[0] == {"role": "user", "content": "where is web?"}
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] is None
    assert [tc["id"] for tc in msgs[1]["tool_calls"]] == ["call_1", "call_2"]
    assert msgs[2] == {"role": "tool", "tool_call_id": "call_1", "content": "the web app"}


def test_flatten_completions_shaped_tool_messages():
    items = [
        {"role": "assistant", "content": None, "tool_calls": [{
            "id": "call_1", "type": "function",
            "function": {"name": "lookup_component", "arguments": '{"q":"web"}'},
        }]},
        {"role": "tool", "tool_call_id": "call_1", "content": "ok"},
    ]
    assert _flatten_items(items) == items


def test_complete_parses_tool_calls_and_forwards_tools():
    seen: list[dict] = []

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        return httpx.Response(200, json=_completion(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "lookup_component", "arguments": '{"q":"web"}'},
                }],
            },
            finish_reason="tool_calls",
        ))

    turn = complete(
        _cfg(handle),
        [{"role": "user", "content": "where is web?"}],
        tools=[LOOKUP],
    )
    assert turn.finish_reason == "tool_calls"
    assert turn.content == ""
    assert len(turn.tool_calls) == 1
    assert turn.tool_calls[0].id == "call_1"
    assert turn.tool_calls[0].name == "lookup_component"
    assert json.loads(turn.tool_calls[0].arguments) == {"q": "web"}
    assert seen[0]["tools"] == [LOOKUP]
    assert seen[0]["tool_choice"] == "auto"
    assert "response_format" not in seen[0]
    assert seen[0]["messages"] == [{"role": "user", "content": "where is web?"}]


def test_complete_text_turn_without_tools():
    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "tools" not in body
        return httpx.Response(200, json=_completion(
            {"role": "assistant", "content": "the web app is the UI"},
        ))

    turn = complete(_cfg(handle), [{"role": "user", "content": "where is web?"}])
    assert turn.content == "the web app is the UI"
    assert turn.tool_calls == []
    assert turn.finish_reason == "stop"


def test_complete_infers_tool_calls_finish_reason():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_completion({
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "c",
                "type": "function",
                "function": {"name": "lookup_component", "arguments": "{}"},
            }],
        }, finish_reason=""))

    turn = complete(_cfg(handle), [{"role": "user", "content": "x"}], tools=[LOOKUP])
    assert turn.finish_reason == "tool_calls"


def test_complete_empty_message_raises():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_completion({"role": "assistant", "content": ""}))

    with pytest.raises(LLMError, match="empty message"):
        complete(_cfg(handle), [{"role": "user", "content": "x"}])


def test_complete_provider_error():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "no tools"}})

    with pytest.raises(LLMError, match="400"):
        complete(_cfg(handle), [{"role": "user", "content": "x"}], tools=[LOOKUP])


def test_chat_still_returns_str_and_skips_tools(good_draft_dict):
    """Mapper/qa path is unchanged: chat() is still a string with json_schema."""
    from terra_analyzer.tasks.architecture.schema import DRAFT_SCHEMA

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "tools" not in body
        assert body["response_format"]["type"] == "json_schema"
        assert body["response_format"]["json_schema"]["schema"] == DRAFT_SCHEMA
        return httpx.Response(200, json=_completion(
            {"role": "assistant", "content": json.dumps(good_draft_dict)},
        ))

    out = chat(_cfg(handle), [{"role": "user", "content": "map this"}])
    assert isinstance(out, str)
    assert json.loads(out)["kind"] == good_draft_dict["kind"]
