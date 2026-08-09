"""Architecture map task."""

from typing import Any

import httpx
from pydantic import ValidationError

from ..inference.client import LLMError, chat, preflight
from ..inference.config import Config
from ..models import Draft, ScanResult
from ..prompts.architecture import SYSTEM_PROMPT, build_prompt
from ..validate import count_files, known_paths, retry_message, validate


class ArchitectureMapper:
    name = "architecture"

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        scan = payload.get("scan")
        if isinstance(scan, ScanResult):
            res = scan
        elif isinstance(scan, dict):
            res = ScanResult.model_validate(scan)
        else:
            raise LLMError("architecture task requires a scan object")
        draft, warnings = self.generate(
            res,
            model=payload.get("model") or "",
            base_url=payload.get("base_url") or "",
            api_key=payload.get("api_key") or "",
        )
        return {
            "draft": draft.model_dump(by_alias=True),
            "warnings": warnings,
        }

    def generate(
        self,
        res: ScanResult,
        model: str = "",
        base_url: str = "",
        client: httpx.Client | None = None,
        api_key: str = "",
    ) -> tuple[Draft, list[str]]:
        """One chat call; second only if validation fails."""
        cfg = Config(
            model=model,
            base_url=base_url,
            client=client or self._client,
            api_key=api_key,
        )
        preflight(cfg)

        known = known_paths(res)
        msgs = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_prompt(res)},
        ]

        for attempt in range(2):
            strict = attempt == 0
            content = chat(cfg, msgs)

            try:
                draft = Draft.model_validate_json(content)
            except ValidationError as e:
                if not strict:
                    raise LLMError(
                        f"model {cfg.model} did not return usable JSON: {e}"
                    ) from e
                msgs += [
                    {"role": "assistant", "content": content},
                    {
                        "role": "user",
                        "content": (
                            "That was not a valid JSON object. Send the whole "
                            "JSON object again, and nothing else."
                        ),
                    },
                ]
                continue

            warnings, errs = validate(draft, known, strict)
            if errs:
                if not strict:
                    raise LLMError(
                        f"map from model {cfg.model} is unusable: " + "; ".join(errs)
                    )
                msgs += [
                    {"role": "assistant", "content": content},
                    {"role": "user", "content": retry_message(errs)},
                ]
                continue
            count_files(draft, res.files)
            return draft, warnings

        raise LLMError(f"model {cfg.model} produced no usable map after two attempts")
