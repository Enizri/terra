"""Agent task protocol — one named capability the analyzer can run."""

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Task(Protocol):
    name: str

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute the task. Payload/result shapes are task-specific."""
        ...
