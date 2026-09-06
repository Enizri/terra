"""Agent task — guide role with a bounded Completions tool loop."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from ...inference.client import preflight
from ...inference.config import Config
from ...retrieve import format_hits, retrieve
from ...roles.guide import SYSTEM_PROMPT, TOOLS
from ...runtime import DEFAULT_MAX_TURNS, PolicyError, iter_loop
from ...tools import GUIDE_TOOLS, lookup_component, read_snippet, retrieve_files
from .models import AgentInput, AgentOutput

__all__ = ["AgentInput", "AgentOutput", "AgentTask"]

_ALLOWED = frozenset(TOOLS)


def _repo_url(architecture_map: Any) -> str:
    if isinstance(architecture_map, dict):
        project = architecture_map.get("project") or {}
        if isinstance(project, dict):
            return str(project.get("repository_url") or "")
    return ""


def _user_content(inp: AgentInput) -> str:
    parts = [f"Question: {inp.question}"]
    if inp.selections:
        parts.append("Selected components:\n" + json.dumps(inp.selections, indent=2))
    elif inp.selection:
        parts.append("Selected component:\n" + json.dumps(inp.selection, indent=2))
    if inp.file_snippet:
        parts.append("Source snippet:\n```\n" + str(inp.file_snippet) + "\n```")
    elif inp.map is not None:
        # Seed the first turn with the same ranked map context `qa` gets. A
        # local model that never reaches for a tool still has to answer from
        # this repository rather than from nothing.
        block = format_hits(retrieve(inp.question, inp.map, inp.selection, inp.selections))
        if block:
            parts.append("Retrieved context:\n" + block)
    parts.append(
        "Use lookup_component, retrieve_files, and read_snippet when you need "
        "more map or file context. Answer from evidence. Do not invent paths."
    )
    return "\n\n".join(parts)


def _parse_args(arguments: str) -> dict[str, Any]:
    try:
        parsed = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def dispatch_guide(inp: AgentInput, name: str, arguments: str) -> str:
    """Run a guide tool. Runtime policy already rejected unknown names and `..`."""
    args = _parse_args(arguments)
    query = str(args.get("query") or inp.question)
    selection_id = str(args.get("selection_id") or "")
    if name == "lookup_component":
        return json.dumps(lookup_component(inp.map, query, selection_id))
    if name == "retrieve_files":
        return json.dumps(retrieve_files(inp.map, query, selection_id))
    if name == "read_snippet":
        path = str(args.get("path") or "")
        repo = str(args.get("repo_url") or "") or _repo_url(inp.map)
        return json.dumps(read_snippet(path, repo))
    raise PolicyError(f'unknown tool "{name}"')


class AgentTask:
    name = "agent"

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
            tools=GUIDE_TOOLS,
            allowed=_ALLOWED,
            dispatch=lambda name, arguments: dispatch_guide(inp, name, arguments),
            max_turns=max_turns,
        )

    def run(self, payload: AgentInput | dict) -> AgentOutput:
        answer = ""
        for event in self.run_stream(payload):
            if "answer" in event and "stage" not in event:
                answer = str(event["answer"])
        return AgentOutput(answer=answer)
