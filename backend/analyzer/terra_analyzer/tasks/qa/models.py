"""Typed I/O for the QA task."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QAInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str = ""
    selection: dict[str, Any] | None = None
    selections: list[dict[str, Any]] | None = None
    file_snippet: str = ""
    map: Any = None
    model: str = ""
    base_url: str = ""
    api_key: str = ""

    @field_validator("question")
    @classmethod
    def _non_empty_question(cls, value: str) -> str:
        text = (value or "").strip()
        if not text:
            raise ValueError('payload must include a non-empty "question"')
        return text


class QAOutput(BaseModel):
    answer: str = Field(min_length=0)
