from terra_analyzer.agents import ArchitectureMapper, default_registry
from terra_analyzer.models import Draft


def test_default_registry_lists_architecture():
    reg = default_registry()
    assert reg.list() == ["architecture", "qa"]
    assert reg.get("architecture") is not None
    assert reg.get("missing") is None


def test_architecture_task_run(monkeypatch, scan, good_draft):
    mapper = ArchitectureMapper()

    def fake_generate(res, model="", base_url="", client=None):
        return good_draft, ["w"]

    monkeypatch.setattr(mapper, "generate", fake_generate)
    out = mapper.run({"scan": scan.model_dump(), "model": ""})
    assert out["warnings"] == ["w"]
    assert Draft.model_validate(out["draft"]).components[0].id == "web"
