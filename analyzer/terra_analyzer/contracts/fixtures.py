"""Load versioned JSON fixtures from the repo `contracts/` tree."""

from pathlib import Path

from .models import AnalyzeRequest, AnalyzeResponse


def repo_contracts_dir() -> Path:
    """`contracts/` at the Terra repo root (sibling of `analyzer/`)."""
    # .../analyzer/terra_analyzer/contracts/fixtures.py → repo root
    return Path(__file__).resolve().parents[3] / "contracts"


def load_analyzer_request(
    name: str = "analyzer-request.v1.json",
) -> AnalyzeRequest:
    path = repo_contracts_dir() / "fixtures" / name
    return AnalyzeRequest.model_validate_json(path.read_text())


def load_analyzer_response(
    name: str = "analyzer-response.v1.json",
) -> AnalyzeResponse:
    path = repo_contracts_dir() / "fixtures" / name
    return AnalyzeResponse.model_validate_json(path.read_text())
