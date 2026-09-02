"""Guide trajectory: must retrieve, must not apply_patch. Recorded Completions only."""

import pytest

from terra_analyzer.evals.trajectory import load_turns, replay
from terra_analyzer.runtime import PolicyError
from terra_analyzer.tools import GUIDE_TOOL_NAMES, GUIDE_TOOLS


def test_guide_readonly_must_retrieve_and_must_not_patch():
    called, answer = replay(
        load_turns("guide_readonly.json"),
        tools=GUIDE_TOOLS,
        allowed=frozenset(GUIDE_TOOL_NAMES),
    )
    assert "lookup_component" in called or "retrieve_files" in called
    assert "apply_patch" not in called
    assert "preview_restart" not in called
    assert answer


def test_guide_rejects_recorded_apply_patch():
    turns = load_turns("editor_patch_restart.json")
    with pytest.raises(PolicyError, match="unknown tool"):
        replay(turns, tools=GUIDE_TOOLS, allowed=frozenset(GUIDE_TOOL_NAMES))
