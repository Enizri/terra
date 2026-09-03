from terra_analyzer.contracts import Draft
from terra_analyzer.tasks import ArchitectureMapper, default_registry
from terra_analyzer.tasks.architecture.mapper import unfence


def test_default_registry_lists_architecture():
    reg = default_registry()
    assert reg.list() == ["agent", "architecture", "editor", "qa"]
    assert reg.get("architecture") is not None
    assert reg.get("agent") is not None
    assert reg.get("editor") is not None
    assert reg.get("missing") is None


def test_registry_run_agent_returns_answer(monkeypatch):
    from terra_analyzer.inference.client import Turn

    monkeypatch.setattr("terra_analyzer.tasks.agent.preflight", lambda cfg: None)
    monkeypatch.setattr(
        "terra_analyzer.runtime.loop.complete",
        lambda *a, **k: Turn(content="from the loop", tool_calls=[], finish_reason="stop"),
    )
    out = default_registry().run("agent", {"question": "where is web?"})
    assert out == {"answer": "from the loop"}


def test_registry_run_editor_returns_answer(monkeypatch):
    from terra_analyzer.inference.client import Turn

    monkeypatch.setattr("terra_analyzer.tasks.editor.preflight", lambda cfg: None)
    monkeypatch.setattr(
        "terra_analyzer.runtime.loop.complete",
        lambda *a, **k: Turn(content="patched", tool_calls=[], finish_reason="stop"),
    )
    out = default_registry().run("editor", {"question": "change the title"})
    assert out == {"answer": "patched"}


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
