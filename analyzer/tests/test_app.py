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
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "architecture" in body["tasks"]
    assert "model" in body
    assert "llm_ok" in body


def test_list_tasks():
    r = client.get("/tasks")
    assert r.status_code == 200
    assert r.json()["tasks"] == ["architecture", "qa"]


def test_analyze_happy_path(monkeypatch, scan, good_draft):
    monkeypatch.setattr(app_module.llm, "generate",
                        lambda res, model="": (good_draft, ["heads up"]))
    r = client.post("/analyze", json={"scan": scan.model_dump(), "model": ""})
    assert r.status_code == 200
    body = r.json()
    assert body["warnings"] == ["heads up"]
    assert [c["id"] for c in body["draft"]["components"]] == ["web", "server", "data"]
    # Wire contract: relationships use "from", parent_id is JSON null.
    assert body["draft"]["relationships"][0]["from"] == "web"
    assert body["draft"]["components"][0]["parent_id"] is None


def test_tasks_architecture_happy_path(monkeypatch, scan, good_draft):
    monkeypatch.setattr(app_module.llm, "generate",
                        lambda res, model="": (good_draft, []))

    def fake_run(name, payload):
        assert name == "architecture"
        d, warnings = app_module.llm.generate(scan, model=payload.get("model", ""))
        return {"draft": d.model_dump(by_alias=True), "warnings": warnings}

    monkeypatch.setattr(app_module.registry, "run", fake_run)
    monkeypatch.setattr(app_module.registry, "get", lambda name: object() if name == "architecture" else None)

    r = client.post("/tasks/architecture", json={"scan": scan.model_dump(), "model": ""})
    assert r.status_code == 200
    assert [c["id"] for c in r.json()["draft"]["components"]] == ["web", "server", "data"]


def test_tasks_unknown_404():
    assert client.post("/tasks/nope", json={}).status_code == 404


def test_analyze_llm_error_becomes_502(monkeypatch, scan):
    def boom(res, model=""):
        raise LLMError("cannot reach a model server at http://localhost:8020/v1")
    monkeypatch.setattr(app_module.llm, "generate", boom)
    r = client.post("/analyze", json={"scan": scan.model_dump()})
    assert r.status_code == 502
    assert "cannot reach a model server" in r.json()["detail"]


def test_analyze_rejects_garbage():
    assert client.post("/analyze", json={"scan": "nope"}).status_code == 422


@pytest.mark.skipif(not (CASE_STUDIES / "memos.map.json").exists(),
                    reason="golden dataset not present")
def test_golden_answer_key_passes_validation():
    """The hand-curated answer key must be structurally clean: unique ids,
    resolvable parents, connected top-level components. memos.scan.json
    predates the files/dirs fields, so path claims are checked against the
    key's own citations."""
    m = json.loads((CASE_STUDIES / "memos.map.json").read_text())
    d = Draft.model_validate({
        "description": m["project"]["description"],
        "kind": m["project"]["kind"],
        "components": m["components"],
        "relationships": m["relationships"],
        "suggested_questions": m["suggested_questions"],
    })
    known = {f.strip().removeprefix("./").removeprefix("/").removesuffix("/")
             for c in m["components"] for f in c["files"]}
    warnings, errs = validate(d, known, strict=True)
    assert errs == []
    assert len(d.components) == 16
    assert len(d.relationships) == 15
