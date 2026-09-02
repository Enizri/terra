"""apply_patch / preview_restart — POST Go preview write routes. No os/exec."""

from __future__ import annotations

from typing import Any

import httpx

from .snippet import api_headers, api_url


class PatchError(Exception):
    """Go API was unreachable or refused the patch."""


class RestartError(Exception):
    """Go API was unreachable or refused the preview restart."""


def apply_patch(
    path: str,
    repo_url: str,
    unified_diff: str,
    *,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    rel = (path or "").strip()
    repo = (repo_url or "").strip()
    diff = unified_diff or ""
    if not rel or not repo:
        raise PatchError("path and repo_url are required")

    close = False
    http = client
    if http is None:
        http = httpx.Client(timeout=30.0)
        close = True
    try:
        try:
            resp = http.post(
                api_url() + "/preview/patch",
                json={"repo_url": repo, "path": rel, "unified_diff": diff},
                headers=api_headers(),
            )
        except httpx.HTTPError as exc:
            raise PatchError(f"cannot reach Go API at {api_url()}: {exc}") from exc
    finally:
        if close:
            http.close()

    if resp.status_code != 200:
        raise PatchError(f"POST /preview/patch {resp.status_code}: {resp.text.strip()[:200]}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise PatchError("POST /preview/patch returned non-JSON") from exc
    if not isinstance(body, dict):
        raise PatchError("POST /preview/patch returned a non-object")
    return {"path": str(body.get("path") or rel), "ok": True}


def preview_restart(
    repo_url: str,
    *,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    repo = (repo_url or "").strip()
    if not repo:
        raise RestartError("repo_url is required")

    close = False
    http = client
    if http is None:
        http = httpx.Client(timeout=120.0)
        close = True
    try:
        try:
            resp = http.post(
                api_url() + "/preview/restart",
                json={"repo_url": repo},
                headers=api_headers(),
            )
        except httpx.HTTPError as exc:
            raise RestartError(f"cannot reach Go API at {api_url()}: {exc}") from exc
    finally:
        if close:
            http.close()

    if resp.status_code != 200:
        raise RestartError(f"POST /preview/restart {resp.status_code}: {resp.text.strip()[:200]}")
    return {"ok": True}
