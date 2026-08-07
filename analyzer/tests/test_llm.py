import json

import httpx
import pytest

from terra_analyzer.inference.config import Config
from terra_analyzer.llm import LLMError, generate
from terra_analyzer.models import Draft
from terra_analyzer.schema import DRAFT_SCHEMA

from .conftest import DEFAULT_MODEL, draft_json, mock_client, openai_handler


def test_generate_against_openai_compatible(scan, good_draft_dict):
    client = mock_client(openai_handler(draft_json(good_draft_dict)))
    draft, warnings = generate(scan, base_url="http://llm/v1", client=client)
    assert [component.id for component in draft.components] == ["web", "server", "data"]
    assert warnings == []
    # file_count comes from the scan, not the model.
    assert draft.components[0].file_count == 1  # web/ -> web/src/app.tsx
    # "" parent_id normalized to None so it serializes as JSON null.
    assert all(component.parent_id is None for component in draft.components)
    assert len(draft.relationships) == 2
    assert draft.relationships[0].from_ == "web"


def test_config_normalizes_bare_url_to_v1():
    cfg = Config(base_url="http://llm:8020", model="m", client=mock_client(lambda request: httpx.Response(404)))
    assert cfg.base_url == "http://llm:8020/v1"


def test_config_sends_authorization_when_api_key_set(monkeypatch):
    monkeypatch.setenv("TERRA_LLM_API_KEY", "sk-test-key")
    seen: list[str | None] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("Authorization"))
        return httpx.Response(200, json={"data": []})

    real_client = httpx.Client

    def client_factory(*args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(handle))
        return real_client(*args, **kwargs)

    monkeypatch.setattr("terra_analyzer.inference.config.httpx.Client", client_factory)
    cfg = Config(base_url="http://llm/v1", model="m")
    assert cfg.client.get("http://llm/v1/models").status_code == 200
    assert seen == ["Bearer sk-test-key"]


def test_config_omits_authorization_when_api_key_unset(monkeypatch):
    monkeypatch.delenv("TERRA_LLM_API_KEY", raising=False)
    monkeypatch.setenv("TERRA_LLM_API_KEY", "")  # empty string also means no auth
    seen: list[str | None] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("Authorization"))
        return httpx.Response(200, json={"data": []})

    real_client = httpx.Client

    def client_factory(*args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(handle))
        return real_client(*args, **kwargs)

    monkeypatch.setattr("terra_analyzer.inference.config.httpx.Client", client_factory)
    cfg = Config(base_url="http://llm/v1", model="m")
    assert cfg.client.get("http://llm/v1/models").status_code == 200
    assert seen == [None]


def test_retry_once_on_validation_errors(scan, good_draft_dict):
    bad = json.loads(json.dumps(good_draft_dict))
    bad["components"][0]["files"] = ["made/up.go"]
    answers = [draft_json(bad), draft_json(good_draft_dict)]
    chats = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": DEFAULT_MODEL}]})
        chats.append(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": answers[len(chats) - 1]},
                         "finish_reason": "stop"}],
        })

    draft, _ = generate(scan, base_url="http://llm/v1", client=mock_client(handle))
    assert len(chats) == 2
    # Schema-constrained request on every chat call.
    assert chats[0]["response_format"]["type"] == "json_schema"
    assert chats[0]["response_format"]["json_schema"]["schema"] == DRAFT_SCHEMA
    retry_msgs = chats[1]["messages"]
    assert retry_msgs[-2]["role"] == "assistant"
    assert "made/up.go" in retry_msgs[-1]["content"]
    assert draft.components[0].files == ["web/"]


def test_second_attempt_is_lenient(scan, good_draft_dict):
    bad = json.loads(json.dumps(good_draft_dict))
    bad["components"][0]["files"] = ["made/up.go", "web/"]

    draft, warnings = generate(
        scan,
        base_url="http://llm/v1",
        client=mock_client(openai_handler(draft_json(bad))),
    )
    assert draft.components[0].files == ["web/"]
    assert any("made/up.go" in warning for warning in warnings)


def test_unparseable_json_retries_then_fails(scan):
    client = mock_client(openai_handler("this is not json"))
    with pytest.raises(LLMError, match="did not return usable JSON"):
        generate(scan, base_url="http://llm/v1", client=client)


def test_truncation_is_reported(scan):
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": DEFAULT_MODEL}]})
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"trunc'}, "finish_reason": "length"}],
        })

    with pytest.raises(LLMError, match="cut off"):
        generate(scan, base_url="http://llm/v1", client=mock_client(handle))


def test_preflight_wrong_model(scan):
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "other-model"}]})

    with pytest.raises(LLMError, match="is serving other-model"):
        generate(scan, base_url="http://llm/v1", client=mock_client(handle))


def test_preflight_accepts_empty_model_list(scan, good_draft_dict):
    """Servers that omit enumeration still work; chat is the real check."""
    answers = draft_json(good_draft_dict)

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": []})
        return httpx.Response(200, json={
            "choices": [{"message": {"content": answers}, "finish_reason": "stop"}],
        })

    draft, _ = generate(scan, base_url="http://llm/v1", client=mock_client(handle))
    assert draft.components


def test_schema_covers_draft_fields():
    assert set(DRAFT_SCHEMA["required"]) == set(Draft.model_fields)
    comp_props = DRAFT_SCHEMA["properties"]["components"]["items"]["properties"]
    assert {"id", "parent_id", "name", "purpose", "importance", "type", "tech", "files"} <= set(comp_props)
