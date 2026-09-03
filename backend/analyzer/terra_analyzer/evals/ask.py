"""Ask evals: question → expected component/file against the golden map. No LLM."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..retrieve import retrieve


def case_studies_dir() -> Path:
    return Path(__file__).resolve().parents[4] / "case-studies"


def load_golden_map() -> dict[str, Any]:
    path = case_studies_dir() / "memos.map.json"
    return json.loads(path.read_text())


def load_ask_cases() -> list[dict[str, Any]]:
    path = case_studies_dir() / "memos.ask.json"
    payload = json.loads(path.read_text())
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"{path} must contain a non-empty cases array")
    return cases


def _file_matches(got: str, expected: str) -> bool:
    g, e = got.rstrip("/"), expected.rstrip("/")
    return g == e or g.startswith(e + "/") or e.startswith(g + "/") or got.startswith(expected) or expected.startswith(got)


def check_case(case: dict[str, Any], architecture_map: dict[str, Any]) -> list[str]:
    question = str(case.get("question") or "").strip()
    expected_ids = [str(i) for i in (case.get("expected_component_ids") or [])]
    expected_files = [str(p) for p in (case.get("expected_files") or [])]
    ident = str(case.get("id") or question[:40])
    if not question or not expected_ids or not expected_files:
        return [f"{ident}: case needs question, expected_component_ids, and expected_files"]

    result = retrieve(question, architecture_map)
    got_ids = [hit.id for hit in result.components]
    got_files = [hit.path for hit in result.files]
    failures: list[str] = []
    if not any(eid in got_ids for eid in expected_ids):
        failures.append(
            f"{ident}: expected a component in {expected_ids}, got {got_ids}"
        )
    if not any(
        any(_file_matches(got, exp) for got in got_files) for exp in expected_files
    ):
        failures.append(
            f"{ident}: expected a file matching {expected_files}, got {got_files}"
        )
    return failures


def assert_memos_ask() -> None:
    architecture_map = load_golden_map()
    failures: list[str] = []
    for case in load_ask_cases():
        failures.extend(check_case(case, architecture_map))
    assert not failures, "memos.ask.json retrieve misses:\n" + "\n".join(failures)
