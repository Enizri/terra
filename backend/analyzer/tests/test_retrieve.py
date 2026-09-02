"""Keyword retrieve over a map (no live LLM, no vector DB)."""

from terra_analyzer.retrieve import (
    COMPONENT_CAP,
    FILE_CAP,
    rank_components,
    rank_files,
    retrieve,
    tokenize,
)
from terra_analyzer.tools import lookup_component, retrieve_files

TINY_MAP = {
    "project": {"repository_url": "https://github.com/acme/notes"},
    "components": [
        {
            "id": "web",
            "name": "Web App",
            "purpose": "Everything the user sees: writing and browsing notes.",
            "tech": ["React", "TypeScript"],
            "files": ["web/src/", "web/src/App.tsx"],
        },
        {
            "id": "auth",
            "name": "Authentication",
            "purpose": "Login, sessions, and SSO via identity providers.",
            "tech": ["JWT", "OAuth2"],
            "files": ["server/auth/", "server/auth/session.go"],
        },
        {
            "id": "data",
            "name": "Data Storage",
            "purpose": "Saves every note in SQLite and finds it again on search.",
            "tech": ["SQLite"],
            "files": ["store/", "store/db.go"],
        },
    ],
}


def test_tokenize_splits_camel_and_dots():
    assert "editor" in tokenize("web.editor MemoEditor")
    assert "login" in tokenize("who can log in")


def test_rank_components_prefers_name_purpose_tech():
    hits = rank_components("How does SSO login work?", TINY_MAP)
    assert hits[0].id == "auth"
    assert len(hits) <= COMPONENT_CAP


def test_rank_files_walks_top_components_and_caps():
    hits = rank_files("SQLite storage for notes", TINY_MAP, cap=FILE_CAP)
    assert hits
    assert all(h.path.startswith("store") for h in hits[:2])
    assert len(hits) <= FILE_CAP


def test_selection_boosts_component():
    hits = rank_components(
        "where is storage",
        TINY_MAP,
        selection={"id": "web", "name": "Web App"},
    )
    assert "web" in [h.id for h in hits]


def test_empty_map_or_question_returns_nothing():
    assert retrieve("", None).components == ()
    assert retrieve("auth", {"components": []}).components == ()


def test_lookup_and_retrieve_files_tools_use_payload_map():
    comps = lookup_component(TINY_MAP, "CodeMirror React notes UI")
    assert comps[0]["id"] == "web"
    files = retrieve_files(TINY_MAP, "JWT sessions")
    assert files[0]["path"].startswith("server/auth")
    assert files[0]["component_id"] == "auth"
