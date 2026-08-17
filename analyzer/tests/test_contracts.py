"""Contract fixtures must decode via Pydantic wire models."""

from terra_analyzer.contracts import (
    AnalyzeRequest,
    AnalyzeResponse,
    load_analyzer_request,
    load_analyzer_response,
)


def test_analyzer_request_fixture_loads():
    req = load_analyzer_request()
    assert isinstance(req, AnalyzeRequest)
    assert req.scan.name == "memos"
    assert req.scan.repository_url.startswith("https://github.com/")
    assert "Go" in req.scan.primary_languages
    assert req.model == "gpt-4o-mini"


def test_analyzer_response_fixture_loads():
    resp = load_analyzer_response()
    assert isinstance(resp, AnalyzeResponse)
    assert resp.draft.description
    assert resp.draft.components
    assert resp.draft.relationships
    assert resp.warnings == []
    # Wire alias: Relationship.from_ serializes as "from".
    dumped = resp.model_dump(by_alias=True)
    assert "from" in dumped["draft"]["relationships"][0]
