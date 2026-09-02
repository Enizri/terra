"""QA task — answers only, no code edits."""

import json

from ...inference.client import chat, preflight
from ...inference.config import Config
from ...roles.guide import SYSTEM_PROMPT
from .models import QAInput, QAOutput

__all__ = ["QAInput", "QAOutput", "QATask"]


class QATask:
    name = "qa"

    def run(self, payload: QAInput | dict) -> QAOutput:
        inp = payload if isinstance(payload, QAInput) else QAInput.model_validate(payload)

        parts = [f"Question: {inp.question}"]
        if inp.selections:
            # Multi-select Ask: Go sends every pick in selections (and still
            # mirrors the primary in selection). Prefer the full list so the
            # prompt is not silently lossy.
            parts.append(
                "Selected components:\n" + json.dumps(inp.selections, indent=2)
            )
        elif inp.selection:
            parts.append(
                "Selected component:\n" + json.dumps(inp.selection, indent=2)
            )
        if inp.file_snippet:
            parts.append("Source snippet:\n```\n" + str(inp.file_snippet) + "\n```")
        if inp.map is not None:
            parts.append("Architecture map:\n" + json.dumps(inp.map))

        # Same per-request routing as /analyze: the workspace reuses the model
        # the user picked for this session, falling back to TERRA_LLM_* env.
        cfg = Config(
            model=inp.model,
            base_url=inp.base_url,
            api_key=inp.api_key,
        )
        preflight(cfg)
        msgs = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ]
        return QAOutput(answer=chat(cfg, msgs, use_schema=False))
