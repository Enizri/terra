from terra_analyzer.models import Draft
from terra_analyzer.validate import (clean_path, count_files, known_paths,
                                     retry_message, validate)

KNOWN = {"web", "web/src", "web/src/app.tsx", "server", "server/main.go", "store", "store/db.go"}


def comp(**kw) -> dict:
    base = {"id": "web", "parent_id": "", "name": "Web", "purpose": "The UI for notes.",
            "importance": "critical", "type": "frontend", "tech": [], "files": ["web/"]}
    base.update(kw)
    return base


def draft(components, relationships=None) -> Draft:
    return Draft.model_validate({
        "description": "x", "kind": "x",
        "components": components, "relationships": relationships or [],
        "suggested_questions": [],
    })


def test_known_paths(scan):
    known = known_paths(scan)
    assert "web/src/app.tsx" in known and "web/src" in known


def test_drops_empty_and_duplicate_ids():
    d = draft([comp(id=""), comp(id="web"), comp(id="web")])
    _, errs = validate(d, KNOWN, strict=True)
    assert len(d.components) == 1
    assert any("empty id" in e for e in errs)
    assert any('duplicate component id "web"' in e for e in errs)


def test_repairs_bad_enums():
    d = draft([comp(importance="vital", type="ui"),
               comp(id="server", type="backend", files=["server/"])],
              [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    _, errs = validate(d, KNOWN, strict=True)
    assert d.components[0].importance == "medium"
    assert d.components[0].type == "backend"
    assert any("set to medium" in e for e in errs)
    assert any("set to backend" in e for e in errs)


def test_drops_invented_paths_and_cleans_real_ones():
    d = draft([comp(files=["/web/src/", "./server/main.go", "made/up.go"]),
               comp(id="server", files=["server/"])],
              [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    _, errs = validate(d, KNOWN, strict=True)
    assert d.components[0].files == ["web/src/", "server/main.go"]
    assert any("made/up.go" in e for e in errs)


def test_parent_inference_from_dotted_id():
    d = draft([comp(), comp(id="web.editor", parent_id="", files=["web/src/"]),
               comp(id="server", files=["server/"])],
              [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    validate(d, KNOWN, strict=True)
    by_id = {c.id: c for c in d.components}
    assert by_id["web.editor"].parent_id == "web"
    assert by_id["web"].parent_id is None


def test_self_and_unknown_parent_made_top_level():
    d = draft([comp(parent_id="web"), comp(id="server", parent_id="ghost", files=["server/"])],
              [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    _, errs = validate(d, KNOWN, strict=True)
    assert all(c.parent_id is None for c in d.components)
    assert any("its own parent" in e for e in errs)
    assert any('"ghost"' in e for e in errs)


def test_drops_bad_relationships():
    d = draft([comp(), comp(id="server", files=["server/"])],
              [{"from": "web", "to": "server", "type": "calls", "because": ["x"]},
               {"from": "web", "to": "web", "type": "calls", "because": ["x"]},
               {"from": "ghost", "to": "web", "type": "calls", "because": ["x"]},
               {"from": "web", "to": "ghost", "type": "calls", "because": ["x"]}])
    _, errs = validate(d, KNOWN, strict=True)
    assert len(d.relationships) == 1
    assert any("to itself" in e for e in errs)
    assert any("from unknown component" in e for e in errs)
    assert any("to unknown component" in e for e in errs)


def test_disconnected_top_level_flagged():
    d = draft([comp(), comp(id="server", files=["server/"])])
    _, errs = validate(d, KNOWN, strict=True)
    assert any('"web" is not connected' in e for e in errs)
    assert any('"server" is not connected' in e for e in errs)


def test_no_usable_components_is_always_an_error():
    d = draft([comp(id="")])
    warnings, errs = validate(d, KNOWN, strict=False)
    assert warnings == []
    assert any("no usable components" in e for e in errs)


def test_lenient_turns_errors_into_warnings():
    d = draft([comp(files=["made/up.go", "web/"]),
               comp(id="server", files=["server/"])],
              [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    warnings, errs = validate(d, KNOWN, strict=False)
    assert errs == []
    assert any("made/up.go" in w for w in warnings)


def test_clean_path():
    assert clean_path(" /web/src/ ") == "web/src/"
    assert clean_path("./main.go") == "main.go"


def test_count_files():
    d = draft([comp(files=["web/"]), comp(id="server", files=["server/main.go"])])
    count_files(d, ["web/src/app.tsx", "web/index.html", "server/main.go"])
    assert d.components[0].file_count == 2
    assert d.components[1].file_count == 1


def test_retry_message_sorted_and_capped():
    errs = [f"problem {i:02d}" for i in range(30, 0, -1)]
    msg = retry_message(errs)
    assert msg.count("\n- ") == 20
    assert "problem 01" in msg and "problem 30" not in msg
    assert "copied exactly from the FILES list" in msg
