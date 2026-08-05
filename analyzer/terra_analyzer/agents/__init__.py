"""Multi-task agent surface for the Terra analyzer."""

from .architecture import ArchitectureMapper
from .registry import TaskRegistry, default_registry

__all__ = ["ArchitectureMapper", "TaskRegistry", "default_registry"]
