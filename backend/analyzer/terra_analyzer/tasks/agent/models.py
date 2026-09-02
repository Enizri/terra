"""Typed I/O for the agent task."""

from ..qa.models import QAInput, QAOutput


class AgentInput(QAInput):
    """QA-shaped payload plus an optional Completions turn cap."""

    max_turns: int | None = None


class AgentOutput(QAOutput):
    pass
