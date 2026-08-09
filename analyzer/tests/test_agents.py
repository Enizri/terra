import pytest

from terra_analyzer.agents import ArchitectureMapper, default_registry
from terra_analyzer.agents.runfile import RunfileWriter, _parse
from terra_analyzer.models import Draft


def test_default_registry_lists_architecture():
    reg = default_registry()
    assert reg.list() == ["architecture", "qa", "runfile"]
    assert reg.get("architecture") is not None
    assert reg.get("missing") is None


def test_architecture_task_run(monkeypatch, scan, good_draft):
    mapper = ArchitectureMapper()

    def fake_generate(res, model="", base_url="", client=None, api_key=""):
        return good_draft, ["w"]

    monkeypatch.setattr(mapper, "generate", fake_generate)
    out = mapper.run({"scan": scan.model_dump(), "model": ""})
    assert out["warnings"] == ["w"]
    assert Draft.model_validate(out["draft"]).components[0].id == "web"


def test_runfile_parse_accepts_fenced_json():
    out = _parse('```json\n{"install": "pip install -e .", "run": "uvicorn app:app --port {port}", "ports": [8000]}\n```')
    assert out["source"] == "agent"
    assert out["run"] == "uvicorn app:app --port {port}"
    assert out["ports"] == [8000]
    assert out["dir"] == ""


def test_runfile_parse_rejects_non_json():
    with pytest.raises(ValueError):
        _parse("I would run npm start")
    with pytest.raises(ValueError):
        _parse('["not", "an", "object"]')


def test_runfile_task_run(monkeypatch, scan):
    monkeypatch.setattr("terra_analyzer.agents.runfile.preflight", lambda cfg: None)
    monkeypatch.setattr(
        "terra_analyzer.agents.runfile.chat",
        lambda cfg, msgs, use_schema=True: '{"run": "go run .", "ports": [8080]}',
    )
    out = RunfileWriter().run({"scan": scan.model_dump()})
    assert out["runfile"] == {
        "source": "agent",
        "install": "",
        "run": "go run .",
        "dir": "",
        "ports": [8080],
    }


def test_runfile_task_requires_scan():
    with pytest.raises(ValueError):
        RunfileWriter().run({})
