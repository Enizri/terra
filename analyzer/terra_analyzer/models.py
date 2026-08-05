"""Pydantic mirrors of Terra's Go wire types (internal/scan.Result and the
draft half of internal/graph). Field names match the Go JSON tags exactly."""

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
    # The model is asked for "" instead of null (nullable types survive
    # Ollama's schema-to-grammar step unreliably); validate() normalizes ""
    # back to None so it serializes as JSON null for Go's *string.
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
    """What the model is asked for: everything that requires judgement, and
    nothing the scan already knows for certain."""
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
