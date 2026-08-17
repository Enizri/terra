"""Task protocol — named handlers with dict payloads at the HTTP boundary."""

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


@runtime_checkable
class Task(Protocol):
    """A registered capability. Prefer Pydantic I/O inside implementations;
    `TaskRegistry.run` accepts a dict from HTTP and normalizes BaseModel results."""

    name: str

    def run(self, payload: dict[str, Any] | BaseModel) -> dict[str, Any] | BaseModel:
        ...
