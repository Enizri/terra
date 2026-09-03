"""Tool schemas and read_snippet / apply_patch HTTP (no live Go server)."""

import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from terra_analyzer.roles.editor import TOOLS as EDITOR_ROLE_TOOLS
from terra_analyzer.roles.guide import TOOLS
from terra_analyzer.tools import (
    APPLY_PATCH,
    EDITOR_TOOL_NAMES,
    EDITOR_TOOLS,
    GUIDE_TOOL_NAMES,
    GUIDE_TOOLS,
    LOOKUP_COMPONENT,
    PREVIEW_RESTART,
    READ_SNIPPET,
    RETRIEVE_FILES,
    PatchError,
    RestartError,
    SnippetError,
    apply_patch,
    preview_restart,
    read_snippet,
)

from .conftest import mock_client


def test_guide_allowlist_matches_schemas():
    names = [tool["function"]["name"] for tool in GUIDE_TOOLS]
    assert names == ["lookup_component", "retrieve_files", "read_snippet"]
    assert TOOLS == GUIDE_TOOL_NAMES == tuple(names)
    assert "apply_patch" not in names
    for schema in (LOOKUP_COMPONENT, RETRIEVE_FILES, READ_SNIPPET):
        assert schema["type"] == "function"
        assert "parameters" in schema["function"]


def test_editor_allowlist_includes_write_tools():
    names = [tool["function"]["name"] for tool in EDITOR_TOOLS]
    assert names == [
        "lookup_component",
        "retrieve_files",
        "read_snippet",
        "apply_patch",
        "preview_restart",
    ]
    assert EDITOR_ROLE_TOOLS == EDITOR_TOOL_NAMES == tuple(names)
    for schema in (APPLY_PATCH, PREVIEW_RESTART):
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


def test_apply_patch_posts_preview_patch(monkeypatch):
    monkeypatch.setenv("TERRA_API_URL", "http://api.example:8080")
    monkeypatch.setenv("TERRA_TOKEN", "secret")
    seen: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = request.content
        return httpx.Response(200, json={"path": "web/src/App.tsx", "ok": True})

    out = apply_patch(
        "web/src/App.tsx",
        "https://github.com/acme/notes",
        "@@ -1 +1 @@\n-a\n+b\n",
        client=mock_client(handle),
    )
    assert out["ok"] is True
    assert seen["auth"] == "Bearer secret"
    parsed = urlparse(seen["url"])
    assert parsed.netloc == "api.example:8080"
    assert parsed.path == "/preview/patch"
    body = json.loads(seen["body"])
    assert body["path"] == "web/src/App.tsx"
    assert body["repo_url"] == "https://github.com/acme/notes"
    assert "unified_diff" in body


def test_apply_patch_http_error_raises():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "path escapes the repository"})

    with pytest.raises(PatchError, match="400"):
        apply_patch("a.go", "https://github.com/acme/notes", "@@ -0,0 +1,1 @@\n+x\n", client=mock_client(handle))


def test_preview_restart_posts_with_token(monkeypatch):
    monkeypatch.setenv("TERRA_API_URL", "http://api.example:8080")
    monkeypatch.setenv("TERRA_TOKEN", "secret")
    seen: dict = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = request.content
        return httpx.Response(200, json={"ok": True})

    out = preview_restart("https://github.com/acme/notes", client=mock_client(handle))
    assert out == {"ok": True}
    assert seen["auth"] == "Bearer secret"
    parsed = urlparse(seen["url"])
    assert parsed.path == "/preview/restart"
    body = json.loads(seen["body"])
    assert body["repo_url"] == "https://github.com/acme/notes"


def test_preview_restart_requires_repo():
    with pytest.raises(RestartError, match="required"):
        preview_restart("")
