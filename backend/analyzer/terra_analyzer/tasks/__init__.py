"""Named analyzer tasks with typed handlers."""

from .registry import TaskRegistry, default_registry

__all__ = ["ArchitectureMapper", "TaskRegistry", "default_registry"]


def __getattr__(name: str):
    if name == "ArchitectureMapper":
        from .architecture import ArchitectureMapper

        return ArchitectureMapper
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
