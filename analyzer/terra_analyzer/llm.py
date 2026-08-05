"""LLM facade: architecture map generation over OpenAI-compatible Chat Completions.

Kept as the stable import path for the Go-facing FastAPI app and tests.
"""

import httpx

from .agents.architecture import ArchitectureMapper
from .inference.client import LLMError
from .models import Draft, ScanResult

__all__ = ["LLMError", "generate"]


def generate(
    res: ScanResult,
    model: str = "",
    base_url: str = "",
    client: httpx.Client | None = None,
) -> tuple[Draft, list[str]]:
    """Asks the model for a map draft of the scanned repository."""
    return ArchitectureMapper(client=client).generate(
        res, model=model, base_url=base_url, client=client
    )
