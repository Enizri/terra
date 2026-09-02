"""Editor trajectory: must apply_patch then preview_restart. Recorded Completions only."""

from terra_analyzer.evals.trajectory import load_turns, replay
from terra_analyzer.tools import EDITOR_TOOL_NAMES, EDITOR_TOOLS


def test_editor_must_call_apply_patch_then_preview_restart():
    called, answer = replay(
        load_turns("editor_patch_restart.json"),
        tools=EDITOR_TOOLS,
        allowed=frozenset(EDITOR_TOOL_NAMES),
    )
    assert called == ["apply_patch", "preview_restart"]
    assert answer
