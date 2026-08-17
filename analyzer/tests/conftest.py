import json

import httpx
import pytest

from terra_analyzer.models import Draft, ScanResult
from terra_analyzer.agents.architecture.validate import known_paths, validate


@pytest.fixture
def scan() -> ScanResult:
    return ScanResult(
        repository_url="https://github.com/acme/notes",
        name="notes",
        stats={"source_files": 3, "top_level_dirs": ["web", "server", "store"]},
        languages=[{"name": "Go", "files": 2}, {"name": "TypeScript", "files": 1}],
        primary_languages=["Go", "TypeScript"],
        tree=[{"path": "web", "files": 1, "languages": ["TypeScript"]},
              {"path": "server", "files": 1, "languages": ["Go"]}],
        dependencies=[{"manifest": "web/package.json", "ecosystem": "npm", "names": ["react", "vite"]}],
        files=["web/src/app.tsx", "server/main.go", "store/db.go"],
        dirs=["web", "web/src", "server", "store"],
    )


@pytest.fixture
def good_draft_dict() -> dict:
    return {
        "description": "Note-taking app for quick capture.",
        "kind": "Self-hosted web application",
        "components": [
            {"id": "web", "parent_id": "", "name": "Web App",
             "purpose": "Everything the user sees: writing and browsing notes.",
             "importance": "critical", "type": "frontend", "tech": ["react"], "files": ["web/"]},
            {"id": "server", "parent_id": "", "name": "Server",
             "purpose": "Answers the app's requests: fetching and saving notes.",
             "importance": "critical", "type": "backend", "tech": [], "files": ["server/"]},
            {"id": "data", "parent_id": "", "name": "Data Storage",
             "purpose": "Saves every note and finds it again on search.",
             "importance": "high", "type": "database", "tech": [], "files": ["store/"]},
        ],
        "relationships": [
            {"from": "web", "to": "server", "type": "calls", "because": ["web/src fetches server endpoints"]},
            {"from": "server", "to": "data", "type": "reads_writes", "because": ["store/db.go saves notes"]},
        ],
        "suggested_questions": ["Where are notes stored?", "How does search work?", "What runs the UI?"],
    }


@pytest.fixture
def good_draft(good_draft_dict, scan) -> Draft:
    """The draft as generate() would return it: already validated, so the ""
    parent_id the model emits has been normalized to None."""
    draft = Draft.model_validate(good_draft_dict)
    validate(draft, known_paths(scan), strict=True)
    return draft


def mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf"


def openai_handler(draft_json: str, model: str = DEFAULT_MODEL):
    """Fakes an OpenAI-compatible server: /v1/models + /v1/chat/completions."""
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": model}]})
        if request.url.path == "/v1/chat/completions":
            return httpx.Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": draft_json},
                             "finish_reason": "stop"}],
            })
        return httpx.Response(404)
    return handle


def schema_rejecting_handler(draft_json: str, model: str = DEFAULT_MODEL,
                             reject_status: int = 400, always: bool = False):
    """Like openai_handler, but 400s any chat body using json_schema.

    Records every chat/completions body on handle.chat_bodies.
    always=True rejects the json_object fallback too.
    """
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": model}]})
        if request.url.path == "/v1/chat/completions":
            body = json.loads(request.content)
            handle.chat_bodies.append(body)
            fmt = (body.get("response_format") or {}).get("type")
            if always or fmt == "json_schema":
                return httpx.Response(reject_status, json={
                    "error": {"message": "response_format.type json_schema is not supported"},
                })
            return httpx.Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": draft_json},
                             "finish_reason": "stop"}],
            })
        return httpx.Response(404)
    handle.chat_bodies = []
    return handle


@pytest.fixture(autouse=True)
def _clear_schema_fallback_cache():
    from terra_analyzer.inference import client

    client._schema_unsupported.clear()
    yield


def draft_json(payload: dict) -> str:
    return json.dumps(payload)
