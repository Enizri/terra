"""Editor task — editor role with write tools over HTTP. Not /jobs/agent."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from ...inference.client import preflight
from ...inference.config import Config
from ...roles.editor import SYSTEM_PROMPT, TOOLS
from ...runtime import DEFAULT_MAX_TURNS, iter_loop
from ...tools import EDITOR_TOOLS, apply_patch, preview_restart
from ..agent import dispatch_guide
from ..agent.models import AgentInput, AgentOutput

__all__ = ["EditorTask"]

_ALLOWED = frozenset(TOOLS)


def _repo_url(architecture_map: Any) -> str:
    if isinstance(architecture_map, dict):
        project = architecture_map.get("project") or {}
        if isinstance(project, dict):
            return str(project.get("repository_url") or "")
    return ""


def _parse_args(arguments: str) -> dict[str, Any]:
    try:
        parsed = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _user_content(inp: AgentInput) -> str:
    parts = [f"Question: {inp.question}"]
    if inp.selections:
        parts.append("Selected components:\n" + json.dumps(inp.selections, indent=2))
    elif inp.selection:
        parts.append("Selected component:\n" + json.dumps(inp.selection, indent=2))
    if inp.file_snippet:
        parts.append("Source snippet:\n```\n" + str(inp.file_snippet) + "\n```")
    parts.append(
        "Use lookup_component, retrieve_files, and read_snippet for context. "
        "Edit with apply_patch, then preview_restart. Do not commit. "
        "Do not invent paths."
    )
    return "\n\n".join(parts)


def dispatch_editor(inp: AgentInput, name: str, arguments: str) -> str:
    """Run an editor tool. Runtime policy already rejected unknown names and `..`."""
    args = _parse_args(arguments)
    if name == "apply_patch":
        path = str(args.get("path") or "")
        repo = str(args.get("repo_url") or "") or _repo_url(inp.map)
        diff = str(args.get("unified_diff") or args.get("diff") or "")
        return json.dumps(apply_patch(path, repo, diff))
    if name == "preview_restart":
        repo = str(args.get("repo_url") or "") or _repo_url(inp.map)
        return json.dumps(preview_restart(repo))
    return dispatch_guide(inp, name, arguments)


class EditorTask:
    name = "editor"

    def run_stream(self, payload: AgentInput | dict) -> Iterator[dict[str, Any]]:
        inp = payload if isinstance(payload, AgentInput) else AgentInput.model_validate(payload)
        max_turns = DEFAULT_MAX_TURNS if inp.max_turns is None else inp.max_turns
        cfg = Config(
            model=inp.model,
            base_url=inp.base_url,
            api_key=inp.api_key,
        )
        preflight(cfg)
        items = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _user_content(inp)},
        ]
        yield from iter_loop(
            cfg,
            items,
            tools=EDITOR_TOOLS,
            allowed=_ALLOWED,
            dispatch=lambda name, arguments: dispatch_editor(inp, name, arguments),
            max_turns=max_turns,
        )

    def run(self, payload: AgentInput | dict) -> AgentOutput:
        answer = ""
        for event in self.run_stream(payload):
            if "answer" in event and "stage" not in event:
                answer = str(event["answer"])
        return AgentOutput(answer=answer)
