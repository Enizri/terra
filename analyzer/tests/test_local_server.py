"""Unit tests for the local OpenAI-compatible server helpers (no model load)."""

from terra_analyzer.local_server.server import (ChatCompletionRequest, ChatMessage,
                                               JsonSchemaFormat, ResponseFormat,
                                               _messages_for_generate)


def test_json_schema_hint_appended_to_system():
    req = ChatCompletionRequest(
        messages=[
            ChatMessage(role="system", content="You are helpful."),
            ChatMessage(role="user", content="map this"),
        ],
        response_format=ResponseFormat(
            type="json_schema",
            json_schema=JsonSchemaFormat(
                name="terra_map",
                schema_={"type": "object", "properties": {"kind": {"type": "string"}}},
            ),
        ),
    )
    msgs = _messages_for_generate(req)
    assert msgs[0]["role"] == "system"
    assert "JSON Schema" in msgs[0]["content"]
    assert '"kind"' in msgs[0]["content"]
    assert msgs[1]["content"] == "map this"


def test_json_schema_hint_prepends_system_when_missing():
    req = ChatCompletionRequest(
        messages=[ChatMessage(role="user", content="hi")],
        response_format=ResponseFormat(
            type="json_schema",
            json_schema=JsonSchemaFormat(schema_={"type": "object"}),
        ),
    )
    msgs = _messages_for_generate(req)
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"


def test_response_format_parses_schema_alias():
    raw = {
        "messages": [{"role": "user", "content": "x"}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "terra_map",
                "strict": True,
                "schema": {"type": "object"},
            },
        },
    }
    req = ChatCompletionRequest.model_validate(raw)
    assert req.response_format.json_schema.schema_ == {"type": "object"}
