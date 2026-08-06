"""QA task — answers only, no code edits."""

import json
from typing import Any

from ..inference.client import chat, preflight
from ..inference.config import Config

QA_SYSTEM = (
    """
    You are Terra, a codebase guide.
    - Answer the user's question about the selected component , 
        or about the project as a whole when no component is selected , using the provided source snippet and architecture map. 
    - Be concrete and brief.
    - Do not propose or write code edits.
    """
)


class QATask:
    name = "qa"

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        question = str(payload.get("question") or "").strip()
        if not question:
            raise ValueError('payload must include a non-empty "question"')

        parts = [f"Question: {question}"]
        if payload.get("selection"):
            parts.append("Selected component:\n" + json.dumps(payload["selection"], indent=2))
        if payload.get("file_snippet"):
            parts.append("Source snippet:\n```\n" + str(payload["file_snippet"]) + "\n```")
        if payload.get("map"):
            parts.append("Architecture map:\n" + json.dumps(payload["map"]))

        cfg = Config()
        preflight(cfg)
        msgs = [
            {"role": "system", "content": QA_SYSTEM},
            {"role": "user", "content": "\n\n".join(parts)},
        ]
        return {"answer": chat(cfg, msgs, use_schema=False)}
