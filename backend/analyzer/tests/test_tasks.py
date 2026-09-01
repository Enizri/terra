from terra_analyzer.contracts import Draft
from terra_analyzer.tasks import ArchitectureMapper, default_registry
from terra_analyzer.tasks.architecture.mapper import unfence


def test_default_registry_lists_architecture():
    reg = default_registry()
    assert reg.list() == ["architecture", "qa"]
    assert reg.get("architecture") is not None
    assert reg.get("missing") is None


def test_architecture_task_run(monkeypatch, scan, good_draft):
    mapper = ArchitectureMapper()

    def fake_generate(res, model="", base_url="", client=None, api_key=""):
        return good_draft, ["w"]

    monkeypatch.setattr(mapper, "generate", fake_generate)
    out = mapper.run({"scan": scan.model_dump(), "model": ""})
    assert out.warnings == ["w"]
    assert Draft.model_validate(out.draft).components[0].id == "web"


OBJ = '{"components": [], "relationships": []}'


def test_unfence_leaves_plain_json_alone():
    assert unfence(OBJ) == OBJ


def test_unfence_strips_json_fence():
    assert unfence("```json\n" + OBJ + "\n```").strip() == OBJ


def test_unfence_strips_bare_fence():
    assert unfence("```\n" + OBJ + "\n```").strip() == OBJ


def test_unfence_tolerates_surrounding_whitespace():
    assert unfence("\n\n```json\n" + OBJ + "\n```\n\n").strip() == OBJ


def test_unfence_handles_unterminated_fence():
    """Truncated at the output cap: the opening fence is there, the closing one isn't."""
    assert unfence("```json\n" + OBJ).strip() == OBJ


def test_unfence_leaves_non_fence_backticks_alone():
    """Not a fence — no newline-terminated info string, so the ticks are payload."""
    weird = '```{"a": 1}```'
    assert unfence(weird) == weird
