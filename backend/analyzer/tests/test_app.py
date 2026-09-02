import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from terra_analyzer.api.app import app, create_app
from terra_analyzer.contracts import Draft
from terra_analyzer.inference.client import LLMError
from terra_analyzer.tasks.architecture.validate import validate

client = TestClient(app)
CASE_STUDIES = Path(__file__).resolve().parents[3] / "case-studies"


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"service": "terra-analyzer", "status": "ok"}


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "architecture" in body["tasks"]
    assert "model" in body
    assert "llm_ok" in body


def test_lifespan_logs_model_and_url(monkeypatch, capfd):
    monkeypatch.setenv("TERRA_LLM_API_KEY", "sk-secret-value")
    with TestClient(app):
        pass
    err = capfd.readouterr().err
    assert "model=" in err
    assert "base_url=" in err
    assert "api_key=set" in err
    assert "sk-secret-value" not in err


def test_lifespan_rejects_localhost_in_container(monkeypatch):
    import terra_analyzer.api.app as app_mod

    monkeypatch.setattr(app_mod, "_in_container", lambda: True)
    monkeypatch.setenv("TERRA_LLM_URL", "http://localhost:8020/v1")
    with (
        pytest.raises(RuntimeError, match="inside a container"),
        TestClient(create_app()),
    ):
        pass


def test_healthz_reports_llm_error(monkeypatch):
    from terra_analyzer.inference import client as inference_client

    def boom(cfg):
        raise LLMError("boom")
    monkeypatch.setattr(inference_client, "preflight", boom)
    body = client.get("/healthz").json()
    assert body["llm_ok"] is False
    assert "boom" in body["llm_error"]


def test_list_tasks():
    response = client.get("/tasks")
    assert response.status_code == 200
    assert response.json()["tasks"] == ["architecture", "qa"]


def test_analyze_happy_path(monkeypatch, scan, good_draft):
    def fake_run(name, payload):
        assert name == "architecture"
        return {"draft": good_draft.model_dump(by_alias=True), "warnings": ["heads up"]}

    monkeypatch.setattr(app.state.registry, "run", fake_run)
    response = client.post("/analyze", json={"scan": scan.model_dump(), "model": ""})
    assert response.status_code == 200
    body = response.json()
    assert body["warnings"] == ["heads up"]
    assert [component["id"] for component in body["draft"]["components"]] == ["web", "server", "data"]
    # Wire contract: relationships use "from", parent_id is JSON null.
    assert body["draft"]["relationships"][0]["from"] == "web"
    assert body["draft"]["components"][0]["parent_id"] is None


def test_tasks_architecture_happy_path(monkeypatch, scan, good_draft):
    def fake_run(name, payload):
        assert name == "architecture"
        return {"draft": good_draft.model_dump(by_alias=True), "warnings": []}

    monkeypatch.setattr(app.state.registry, "run", fake_run)
    monkeypatch.setattr(app.state.registry, "get", lambda name: object() if name == "architecture" else None)

    response = client.post("/tasks/architecture", json={"scan": scan.model_dump(), "model": ""})
    assert response.status_code == 200
    assert [component["id"] for component in response.json()["draft"]["components"]] == ["web", "server", "data"]


def test_tasks_qa_multiselect(monkeypatch):
    """POST /tasks/qa must pass every Ask selection into the prompt."""
    captured: dict = {}

    def fake_chat(cfg, msgs, use_schema=False):
        captured["msgs"] = msgs
        return "both components share the request path"

    import terra_analyzer.tasks.qa as qa_mod

    monkeypatch.setattr(qa_mod, "preflight", lambda cfg: None)
    monkeypatch.setattr(qa_mod, "chat", fake_chat)

    sels = [
        {"id": "web", "file": "web/App.tsx", "label": "Web"},
        {"id": "server", "file": "internal/server/ask.go", "label": "Server"},
    ]
    response = client.post(
        "/tasks/qa",
        json={
            "question": "How do these relate?",
            "selection": sels[-1],
            "selections": sels,
            "model": "",
        },
    )
    assert response.status_code == 200
    assert response.json()["answer"] == "both components share the request path"
    user = captured["msgs"][1]["content"]
    assert "Selected components:" in user
    assert "web/App.tsx" in user
    assert "internal/server/ask.go" in user
    assert "How do these relate?" in user


def test_tasks_qa_prepends_retrieve_hits_without_snippet(monkeypatch):
    """No file_snippet → keyword hits go into the same chat() call, not a tool loop."""
    captured: dict = {}

    def fake_chat(cfg, msgs, use_schema=False):
        captured["msgs"] = msgs
        captured["use_schema"] = use_schema
        return "auth owns sessions"

    import terra_analyzer.tasks.qa as qa_mod

    monkeypatch.setattr(qa_mod, "preflight", lambda cfg: None)
    monkeypatch.setattr(qa_mod, "chat", fake_chat)

    repo_map = {
        "project": {"repository_url": "https://github.com/acme/notes"},
        "components": [
            {
                "id": "web",
                "name": "Web App",
                "purpose": "Writing notes in the browser.",
                "tech": ["React"],
                "files": ["web/src/"],
            },
            {
                "id": "auth",
                "name": "Authentication",
                "purpose": "Login, sessions, and SSO identity providers.",
                "tech": ["JWT"],
                "files": ["server/auth/"],
            },
        ],
    }
    response = client.post(
        "/tasks/qa",
        json={
            "question": "How does SSO login work?",
            "map": repo_map,
            "model": "",
        },
    )
    assert response.status_code == 200
    assert captured["use_schema"] is False
    user = captured["msgs"][1]["content"]
    assert "Retrieved context:" in user
    assert "auth" in user
    assert "server/auth/" in user
    assert "Architecture map:" in user


def test_tasks_qa_skips_retrieve_when_snippet_present(monkeypatch):
    captured: dict = {}

    def fake_chat(cfg, msgs, use_schema=False):
        captured["msgs"] = msgs
        return "here is the snippet"

    import terra_analyzer.tasks.qa as qa_mod

    monkeypatch.setattr(qa_mod, "preflight", lambda cfg: None)
    monkeypatch.setattr(qa_mod, "chat", fake_chat)

    response = client.post(
        "/tasks/qa",
        json={
            "question": "What does this file do?",
            "file_snippet": "package auth\nfunc Login() {}",
            "map": {
                "components": [
                    {
                        "id": "auth",
                        "name": "Authentication",
                        "purpose": "Login and SSO.",
                        "files": ["server/auth/"],
                    }
                ]
            },
        },
    )
    assert response.status_code == 200
    user = captured["msgs"][1]["content"]
    assert "Retrieved context:" not in user
    assert "Source snippet:" in user
    assert "package auth" in user


def test_tasks_unknown_404():
    assert client.post("/tasks/nope", json={}).status_code == 404


def test_analyze_llm_error_becomes_502(monkeypatch, scan):
    def boom(name, payload):
        raise LLMError("cannot reach a model server at http://localhost:8020/v1")

    monkeypatch.setattr(app.state.registry, "run", boom)
    response = client.post("/analyze", json={"scan": scan.model_dump()})
    assert response.status_code == 502
    assert "cannot reach a model server" in response.json()["detail"]


def test_analyze_rejects_garbage():
    assert client.post("/analyze", json={"scan": "nope"}).status_code == 422


def test_golden_answer_key_passes_validation():
    """The hand-curated answer key must be structurally clean: unique ids,
    resolvable parents, connected top-level components. memos.scan.json
    predates the files/dirs fields, so path claims are checked against the
    key's own citations."""
    golden = CASE_STUDIES / "memos.map.json"
    assert golden.is_file(), (
        f"canonical golden fixture missing: {golden} "
            "(do not relocate backend/analyzer without updating CASE_STUDIES)"
    )
    map_data = json.loads(golden.read_text())
    draft = Draft.model_validate({
        "description": map_data["project"]["description"],
        "kind": map_data["project"]["kind"],
        "components": map_data["components"],
        "relationships": map_data["relationships"],
        "suggested_questions": map_data["suggested_questions"],
    })
    known = {path.strip().removeprefix("./").removeprefix("/").removesuffix("/")
             for component in map_data["components"] for path in component["files"]}
    _warnings, errs = validate(draft, known, strict=True)
    assert errs == []
    assert len(draft.components) == 16
    assert len(draft.relationships) == 15
