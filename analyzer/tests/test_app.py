import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from terra_analyzer import app as app_module
from terra_analyzer.app import app
from terra_analyzer.llm import LLMError
from terra_analyzer.models import Draft
from terra_analyzer.validate import validate

client = TestClient(app)
CASE_STUDIES = Path(__file__).resolve().parents[2] / "case-studies"


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "architecture" in body["tasks"]
    assert "model" in body
    assert "llm_ok" in body


def test_list_tasks():
    response = client.get("/tasks")
    assert response.status_code == 200
    assert response.json()["tasks"] == ["architecture", "qa", "runfile"]


def test_analyze_happy_path(monkeypatch, scan, good_draft):
    monkeypatch.setattr(app_module.llm, "generate",
                        lambda res, model="": (good_draft, ["heads up"]))
    response = client.post("/analyze", json={"scan": scan.model_dump(), "model": ""})
    assert response.status_code == 200
    body = response.json()
    assert body["warnings"] == ["heads up"]
    assert [component["id"] for component in body["draft"]["components"]] == ["web", "server", "data"]
    # Wire contract: relationships use "from", parent_id is JSON null.
    assert body["draft"]["relationships"][0]["from"] == "web"
    assert body["draft"]["components"][0]["parent_id"] is None


def test_tasks_architecture_happy_path(monkeypatch, scan, good_draft):
    monkeypatch.setattr(app_module.llm, "generate",
                        lambda res, model="": (good_draft, []))

    def fake_run(name, payload):
        assert name == "architecture"
        draft, warnings = app_module.llm.generate(scan, model=payload.get("model", ""))
        return {"draft": draft.model_dump(by_alias=True), "warnings": warnings}

    monkeypatch.setattr(app_module.registry, "run", fake_run)
    monkeypatch.setattr(app_module.registry, "get", lambda name: object() if name == "architecture" else None)

    response = client.post("/tasks/architecture", json={"scan": scan.model_dump(), "model": ""})
    assert response.status_code == 200
    assert [component["id"] for component in response.json()["draft"]["components"]] == ["web", "server", "data"]


def test_tasks_unknown_404():
    assert client.post("/tasks/nope", json={}).status_code == 404


def test_analyze_llm_error_becomes_502(monkeypatch, scan):
    def boom(res, model=""):
        raise LLMError("cannot reach a model server at http://localhost:8020/v1")
    monkeypatch.setattr(app_module.llm, "generate", boom)
    response = client.post("/analyze", json={"scan": scan.model_dump()})
    assert response.status_code == 502
    assert "cannot reach a model server" in response.json()["detail"]


def test_analyze_rejects_garbage():
    assert client.post("/analyze", json={"scan": "nope"}).status_code == 422


@pytest.mark.skipif(not (CASE_STUDIES / "memos.map.json").exists(),
                    reason="golden dataset not present")
def test_golden_answer_key_passes_validation():
    """The hand-curated answer key must be structurally clean: unique ids,
    resolvable parents, connected top-level components. memos.scan.json
    predates the files/dirs fields, so path claims are checked against the
    key's own citations."""
    map_data = json.loads((CASE_STUDIES / "memos.map.json").read_text())
    draft = Draft.model_validate({
        "description": map_data["project"]["description"],
        "kind": map_data["project"]["kind"],
        "components": map_data["components"],
        "relationships": map_data["relationships"],
        "suggested_questions": map_data["suggested_questions"],
    })
    known = {path.strip().removeprefix("./").removeprefix("/").removesuffix("/")
             for component in map_data["components"] for path in component["files"]}
    warnings, errs = validate(draft, known, strict=True)
    assert errs == []
    assert len(draft.components) == 16
    assert len(draft.relationships) == 15
