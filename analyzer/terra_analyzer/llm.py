"""Architecture map generation facade (stable import for FastAPI and tests)."""

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
    api_key: str = "",
) -> tuple[Draft, list[str]]:
    return ArchitectureMapper(client=client).generate(
        res, model=model, base_url=base_url, client=client, api_key=api_key
    )
