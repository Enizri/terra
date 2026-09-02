"""read_snippet — GET /files on the Go API. Python never opens the checkout."""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_API_URL = "http://127.0.0.1:8080"


class SnippetError(Exception):
    """Go API was unreachable or refused the path."""


def api_url() -> str:
    return (os.environ.get("TERRA_API_URL") or DEFAULT_API_URL).rstrip("/")


def api_headers() -> dict[str, str]:
    """Same bearer the Go API already accepts as TERRA_TOKEN."""
    token = (os.environ.get("TERRA_TOKEN") or "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def read_snippet(
    path: str,
    repo_url: str,
    *,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    rel = (path or "").strip()
    repo = (repo_url or "").strip()
    if not rel or not repo:
        raise SnippetError("path and repo_url are required")

    close = False
    http = client
    if http is None:
        http = httpx.Client(timeout=10.0)
        close = True
    try:
        try:
            resp = http.get(
                api_url() + "/files",
                params={"repo_url": repo, "path": rel},
                headers=api_headers(),
            )
        except httpx.HTTPError as exc:
            raise SnippetError(f"cannot reach Go API at {api_url()}: {exc}") from exc
    finally:
        if close:
            http.close()

    if resp.status_code != 200:
        raise SnippetError(f"GET /files {resp.status_code}: {resp.text.strip()[:200]}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise SnippetError("GET /files returned non-JSON") from exc
    if not isinstance(body, dict):
        raise SnippetError("GET /files returned a non-object")
    if body.get("starting"):
        raise SnippetError("preview checkout is not ready")
    if "content" not in body:
        raise SnippetError("path is a directory, not a file")
    return {"path": str(body.get("path") or rel), "content": str(body.get("content") or "")}
