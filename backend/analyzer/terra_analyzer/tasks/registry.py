"""Named task registry."""

from typing import Any

from pydantic import BaseModel

from .base import Task


class TaskRegistry:
    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}

    def register(self, task: Task) -> None:
        self._tasks[task.name] = task

    def get(self, name: str) -> Task | None:
        return self._tasks.get(name)

    def list(self) -> list[str]:
        return sorted(self._tasks)

    def run(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        task = self.get(name)
        if task is None:
            raise KeyError(name)
        out = task.run(payload)
        if isinstance(out, BaseModel):
            return out.model_dump(by_alias=True)
        return out


def default_registry() -> TaskRegistry:
    from .architecture import ArchitectureMapper
    from .qa import QATask

    reg = TaskRegistry()
    reg.register(ArchitectureMapper())
    reg.register(QATask())
    return reg
