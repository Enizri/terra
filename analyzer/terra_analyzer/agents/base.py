"""Agent task protocol."""

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Task(Protocol):
    name: str

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...
