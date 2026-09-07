from terra_analyzer.contracts import Draft
from terra_analyzer.tasks.architecture.schema import MAX_PATH_CHOICES, draft_schema
from terra_analyzer.tasks.architecture.validate import (
    clean_path,
    count_files,
    known_paths,
    path_choices,
    retry_message,
    unusable,
    validate,
)

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
    result = draft([comp(id=""), comp(id="web"), comp(id="web")])
    _, errs = validate(result, KNOWN, strict=True)
    assert len(result.components) == 1
    assert any("empty id" in err for err in errs)
    assert any('duplicate component id "web"' in err for err in errs)


def test_repairs_bad_enums():
    result = draft([comp(importance="vital", type="ui"),
                    comp(id="server", type="backend", files=["server/"])],
                   [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    _, errs = validate(result, KNOWN, strict=True)
    assert result.components[0].importance == "medium"
    assert result.components[0].type == "backend"
    assert any("set to medium" in err for err in errs)
    assert any("set to backend" in err for err in errs)


def test_drops_invented_paths_and_cleans_real_ones():
    result = draft([comp(files=["/web/src/", "./server/main.go", "made/up.go"]),
                    comp(id="server", files=["server/"])],
                   [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    _, errs = validate(result, KNOWN, strict=True)
    assert result.components[0].files == ["web/src/", "server/main.go"]
    assert any("made/up.go" in err for err in errs)


def test_parent_inference_from_dotted_id():
    result = draft([comp(), comp(id="web.editor", parent_id="", files=["web/src/"]),
                    comp(id="server", files=["server/"])],
                   [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    validate(result, KNOWN, strict=True)
    by_id = {component.id: component for component in result.components}
    assert by_id["web.editor"].parent_id == "web"
    assert by_id["web"].parent_id is None


def test_self_and_unknown_parent_made_top_level():
    result = draft([comp(parent_id="web"), comp(id="server", parent_id="ghost", files=["server/"])],
                   [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    _, errs = validate(result, KNOWN, strict=True)
    assert all(component.parent_id is None for component in result.components)
    assert any("its own parent" in err for err in errs)
    assert any('"ghost"' in err for err in errs)


def test_parent_from_another_column_is_made_top_level():
    """The diagram draws a card inside its parent, so a database nested under
    the web app would simply vanish."""
    result = draft(
        [comp(), comp(id="store", parent_id="web", type="database", files=["store/"]),
         comp(id="server", parent_id="web", type="backend", files=["server/"])],
        [{"from": "web", "to": "server", "type": "calls", "because": ["x"]},
         {"from": "server", "to": "store", "type": "reads_writes", "because": ["x"]}],
    )
    _, errs = validate(result, KNOWN, strict=True)
    assert all(component.parent_id is None for component in result.components)
    assert any('"store" (database) has parent "web" (frontend)' in err for err in errs)


def test_same_column_parent_survives():
    result = draft(
        [comp(), comp(id="web.editor", parent_id="web", type="frontend", files=["web/src/"]),
         comp(id="server", files=["server/"])],
        [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}],
    )
    validate(result, KNOWN, strict=True)
    by_id = {component.id: component for component in result.components}
    assert by_id["web.editor"].parent_id == "web"


def test_a_hierarchy_that_would_draw_one_card_is_flattened():
    result = draft(
        [comp(), comp(id="web.editor", parent_id="web", files=["web/src/"]),
         comp(id="web.timeline", parent_id="web", files=["web/src/app.tsx"])],
        [{"from": "web.editor", "to": "web.timeline", "type": "calls", "because": ["x"]}],
    )
    _, errs = validate(result, KNOWN, strict=True)
    assert all(component.parent_id is None for component in result.components)
    assert any("single card" in err for err in errs)


def test_drops_bad_relationships():
    result = draft([comp(), comp(id="server", files=["server/"])],
                   [{"from": "web", "to": "server", "type": "calls", "because": ["x"]},
                    {"from": "web", "to": "web", "type": "calls", "because": ["x"]},
                    {"from": "ghost", "to": "web", "type": "calls", "because": ["x"]},
                    {"from": "web", "to": "ghost", "type": "calls", "because": ["x"]}])
    _, errs = validate(result, KNOWN, strict=True)
    assert len(result.relationships) == 1
    assert any("to itself" in err for err in errs)
    assert any("from unknown component" in err for err in errs)
    assert any("to unknown component" in err for err in errs)


def test_disconnected_top_level_flagged():
    result = draft([comp(), comp(id="server", files=["server/"])])
    _, errs = validate(result, KNOWN, strict=True)
    assert any('"web" is not connected' in err for err in errs)
    assert any('"server" is not connected' in err for err in errs)


def test_no_usable_components_is_always_an_error():
    result = draft([comp(id="")])
    warnings, errs = validate(result, KNOWN, strict=False)
    assert warnings == []
    assert any("no usable components" in err for err in errs)


def test_lenient_turns_errors_into_warnings():
    result = draft([comp(files=["made/up.go", "web/"]),
                    comp(id="server", files=["server/"])],
                   [{"from": "web", "to": "server", "type": "calls", "because": ["x"]}])
    warnings, errs = validate(result, KNOWN, strict=False)
    assert errs == []
    assert any("made/up.go" in warning for warning in warnings)


def test_clean_path():
    assert clean_path(" /web/src/ ") == "web/src/"
    assert clean_path("./main.go") == "main.go"


def test_count_files():
    result = draft([comp(files=["web/"]), comp(id="server", files=["server/main.go"])])
    count_files(result, ["web/src/app.tsx", "web/index.html", "server/main.go"])
    assert result.components[0].file_count == 2
    assert result.components[1].file_count == 1


def test_retry_message_sorted_and_capped():
    errs = [f"problem {i:02d}" for i in range(30, 0, -1)]
    msg = retry_message(errs)
    assert msg.count("\n- ") == 20
    assert "problem 01" in msg and "problem 30" not in msg
    assert "copied exactly from the FILES list" in msg


def test_path_choices_are_directories_shallowest_first(scan):
    choices = path_choices(scan, MAX_PATH_CHOICES)
    assert choices == ["server/", "store/", "web/", "web/src/"]


def test_draft_schema_pins_real_directories_as_an_enum(scan):
    schema = draft_schema(path_choices(scan, MAX_PATH_CHOICES))
    item = schema["properties"]["components"]["items"]["properties"]["files"]["items"]
    assert item["enum"] == ["server/", "store/", "web/", "web/src/"]
    # Over the cap the enum is dropped so hosted structured-output stays valid.
    unbounded = draft_schema(["a/"] * (MAX_PATH_CHOICES + 1))
    assert "enum" not in unbounded["properties"]["components"]["items"]["properties"]["files"]["items"]


def test_unusable_rejects_a_map_that_would_mislead():
    thin = draft([comp(), comp(id="server", files=["server/"])])
    assert any("no relationship" in reason for reason in unusable(thin))
    ok = draft(
        [comp(), comp(id="server", files=["server/"]),
         comp(id="store", files=["store/"])],
        [{"from": "web", "to": "server", "type": "calls", "because": ["x"]},
         {"from": "server", "to": "store", "type": "reads_writes", "because": ["x"]}],
    )
    assert unusable(ok) == []
