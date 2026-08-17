"""Typed I/O for the architecture map task."""

from pydantic import BaseModel, ConfigDict

from ...contracts import Draft, ScanResult


class ArchitectureInput(BaseModel):
    model_config = ConfigDict(extra="ignore", arbitrary_types_allowed=True)

    scan: ScanResult
    model: str = ""
    base_url: str = ""
    api_key: str = ""


class ArchitectureOutput(BaseModel):
    draft: Draft
    warnings: list[str] = []
