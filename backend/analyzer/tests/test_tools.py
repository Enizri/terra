"""Tool schemas and read_snippet HTTP (no live Go server)."""

from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from terra_analyzer.roles.guide import TOOLS
from terra_analyzer.tools import (
    GUIDE_TOOL_NAMES,
    GUIDE_TOOLS,
    LOOKUP_COMPONENT,
    READ_SNIPPET,
    RETRIEVE_FILES,
    SnippetError,
    read_snippet,
)

from .conftest import mock_client


def test_guide_allowlist_matches_schemas():
    names = [tool["function"]["name"] for tool in GUIDE_TOOLS]
    assert names == ["lookup_component", "retrieve_files", "read_snippet"]
    assert TOOLS == GUIDE_TOOL_NAMES == tuple(names)
    for schema in (LOOKUP_COMPONENT, RETRIEVE_FILES, READ_SNIPPET):
        assert schema["type"] == "function"
        assert "parameters" in schema["function"]


def test_read_snippet_gets_files_with_token(monkeypatch):
    monkeypatch.setenv("TERRA_API_URL", "http://api.example:8080")
    monkeypatch.setenv("TERRA_TOKEN", "secret")
    seen: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"path": "server/auth.go", "content": "package auth"})

    out = read_snippet(
        "server/auth.go",
        "https://github.com/acme/notes",
        client=mock_client(handle),
    )
    assert out == {"path": "server/auth.go", "content": "package auth"}
    assert seen["auth"] == "Bearer secret"
    parsed = urlparse(seen["url"])
    assert parsed.scheme == "http"
    assert parsed.netloc == "api.example:8080"
    assert parsed.path == "/files"
    query = parse_qs(parsed.query)
    assert query["repo_url"] == ["https://github.com/acme/notes"]
    assert query["path"] == ["server/auth.go"]


def test_read_snippet_preview_starting_raises():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"starting": True})

    with pytest.raises(SnippetError, match="not ready"):
        read_snippet("a.go", "https://github.com/acme/notes", client=mock_client(handle))


def test_read_snippet_directory_listing_raises():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"path": "server", "entries": [{"name": "a.go"}]})

    with pytest.raises(SnippetError, match="directory"):
        read_snippet("server", "https://github.com/acme/notes", client=mock_client(handle))


def test_read_snippet_requires_path_and_repo():
    with pytest.raises(SnippetError, match="required"):
        read_snippet("", "https://github.com/acme/notes")
