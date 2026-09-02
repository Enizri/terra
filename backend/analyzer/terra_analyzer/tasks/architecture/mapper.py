"""Architecture map task."""

import httpx
from pydantic import ValidationError

from ...contracts import Draft, ScanResult
from ...inference.client import LLMError, chat, preflight
from ...inference.config import Config
from ...roles.mapper import SYSTEM_PROMPT
from .models import ArchitectureInput, ArchitectureOutput
from .prompt import build_prompt
from .validate import count_files, known_paths, retry_message, validate


def unfence(content: str) -> str:
    """Strip a markdown code fence around a JSON reply.

    The schema and the system prompt both say "a single JSON object and nothing
    else", and most models comply — but a chat-tuned model reaching for its
    instinct to format code will wrap the object in ```json … ```, and pydantic
    rejects the whole thing over the backticks. Cheaper to unwrap here than to
    spend a retry asking again.

    Only applied to this task: `qa` answers are prose, where a fence is content.
    """
    s = content.strip()
    if not s.startswith("```"):
        return content
    body = s[3:]
    nl = body.find("\n")
    if nl == -1:
        return content
    # The info string, if any, is a bare language tag ("json"). Anything else
    # means these backticks are part of the payload, not a fence around it.
    info = body[:nl].strip()
    if info and not info.isalnum():
        return content
    body = body[nl + 1 :]
    close = body.rfind("```")
    return body[:close] if close != -1 else body


class ArchitectureMapper:
    name = "architecture"

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    def run(self, payload: ArchitectureInput | dict) -> ArchitectureOutput:
        inp = (
            payload
            if isinstance(payload, ArchitectureInput)
            else ArchitectureInput.model_validate(payload)
        )
        draft, warnings = self.generate(
            inp.scan,
            model=inp.model,
            base_url=inp.base_url,
            api_key=inp.api_key,
        )
        return ArchitectureOutput(draft=draft, warnings=warnings)

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
                draft = Draft.model_validate_json(unfence(content))
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
