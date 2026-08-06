"""Runfile task: write a boot spec for a repo when Go's deterministic
inference (Dockerfile → compose → manifests) found nothing. The result is
recorded, never auto-executed on a host — sandboxes only."""

import json
import re
from typing import Any

from ..inference.client import chat, preflight
from ..inference.config import Config

RUNFILE_SYSTEM = (
    """
    You write a Runfile: the minimal spec to install and run a repository.
    Reply with ONE JSON object and nothing else, shaped exactly:
    {"install": "<shell command or empty string>",
     "run": "<shell command that starts the service; use {port} for the port>",
     "dir": "<repo-relative working directory or empty string>",
     "ports": [<ints the app listens on>]}
    - Prefer the repo's own scripts and standard tooling.
    - One service only: the thing a visitor would look at.
    - If the repo is a library with nothing to run, use an empty "run".
    """
)

_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _parse(content: str) -> dict[str, Any]:
    m = _FENCE.search(content)
    if m:
        content = m.group(1)
    try:
        raw = json.loads(content)
    except ValueError as e:
        raise ValueError(f"model did not return JSON: {e}") from e
    if not isinstance(raw, dict):
        raise ValueError("model returned JSON that is not an object")
    return {
        "source": "agent",
        "install": str(raw.get("install") or ""),
        "run": str(raw.get("run") or ""),
        "dir": str(raw.get("dir") or ""),
        "ports": [int(p) for p in raw.get("ports") or [] if isinstance(p, (int, float))],
    }


class RunfileWriter:
    name = "runfile"

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        scan = payload.get("scan") or {}
        if not isinstance(scan, dict) or not scan:
            raise ValueError('payload must include a "scan" object')

        facts = {
            key: scan.get(key)
            for key in ("name", "primary_languages", "dependencies", "files", "dirs")
        }
        cfg = Config()
        preflight(cfg)
        msgs = [
            {"role": "system", "content": RUNFILE_SYSTEM},
            {"role": "user", "content": json.dumps(facts)[:16000]},
        ]
        return {"runfile": _parse(chat(cfg, msgs, use_schema=False))}
