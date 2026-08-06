"""Pydantic mirrors of Go wire types (scan.Result + graph draft)."""

from pydantic import BaseModel, ConfigDict, Field


class Stats(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source_files: int = 0
    top_level_dirs: list[str] = []


class LanguageStat(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    files: int = 0


class DirSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")
    path: str
    files: int = 0
    languages: list[str] = []


class Manifest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    manifest: str
    ecosystem: str = ""
    names: list[str] = []


class ScanResult(BaseModel):
    model_config = ConfigDict(extra="ignore")
    repository_url: str = ""
    name: str = ""
    stats: Stats = Stats()
    languages: list[LanguageStat] = []
    primary_languages: list[str] = []
    tree: list[DirSummary] = []
    dependencies: list[Manifest] = []
    files: list[str] = []
    dirs: list[str] = []


class Component(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = ""
    # Model emits ""; validate() → None for Go's *string (nullable schema is unreliable).
    parent_id: str | None = None
    name: str = ""
    purpose: str = ""
    importance: str = ""
    type: str = ""
    tech: list[str] = []
    files: list[str] = []
    file_count: int = 0


class Relationship(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    from_: str = Field("", alias="from")
    to: str = ""
    type: str = ""
    because: list[str] = []


class Draft(BaseModel):
    """Judgement fields only — scan already knows the rest."""
    model_config = ConfigDict(extra="ignore")
    description: str = ""
    kind: str = ""
    components: list[Component] = []
    relationships: list[Relationship] = []
    suggested_questions: list[str] = []


class AnalyzeRequest(BaseModel):
    scan: ScanResult
    model: str = ""


class AnalyzeResponse(BaseModel):
    draft: Draft
    warnings: list[str] = []
