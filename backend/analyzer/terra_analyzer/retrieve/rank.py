"""Keyword/BM25 ranking over an architecture map. No vector DB."""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

COMPONENT_CAP = 3
FILE_CAP = 4

_K1 = 1.5
_B = 0.75
_SELECT_BOOST = 5.0

_STOP = frozenset({
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "how",
    "does", "do", "did", "what", "where", "which", "who", "whom", "is", "are",
    "was", "were", "be", "been", "being", "it", "its", "this", "that", "these",
    "those", "with", "from", "into", "vs", "via", "as", "at", "by", "not",
    "i", "we", "you", "they", "them", "their", "our", "my", "when", "why",
    "would", "could", "should", "can", "may", "might", "new", "add", "get",
    "use", "used", "using", "work", "works", "exist", "exists", "about",
    "than", "then", "also", "just", "like", "one", "all", "any", "some",
    "there", "here", "out", "up", "if", "so", "but", "else", "per", "each",
})

_CAMEL = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+")
_TOKEN = re.compile(r"[A-Za-z0-9]+")


@dataclass(frozen=True)
class ComponentHit:
    id: str
    name: str
    purpose: str
    tech: tuple[str, ...]
    files: tuple[str, ...]
    score: float


@dataclass(frozen=True)
class FileHit:
    path: str
    component_id: str
    score: float


@dataclass(frozen=True)
class RetrieveResult:
    components: tuple[ComponentHit, ...]
    files: tuple[FileHit, ...]


def tokenize(text: str) -> list[str]:
    """Lowercased tokens; splits camelCase and dotted ids."""
    if not text:
        return []
    pieces: list[str] = []
    for raw in _TOKEN.findall(text):
        if any(c.isupper() for c in raw[1:]):
            pieces.extend(p.lower() for p in _CAMEL.findall(raw) if p)
        else:
            pieces.append(raw.lower())
    kept = [p for p in pieces if p not in _STOP and len(p) > 1]
    # "log in" / "sign in" in prose should still match a "login" query.
    for a, b in pairwise(pieces):
        combo = a + b
        if len(combo) >= 4 and combo not in _STOP:
            kept.append(combo)
    return kept


def _as_dict(component: Any) -> dict[str, Any]:
    if hasattr(component, "model_dump"):
        return component.model_dump()
    if isinstance(component, dict):
        return component
    return {}


def components_of(architecture_map: Any) -> list[dict[str, Any]]:
    if architecture_map is None:
        return []
    if isinstance(architecture_map, list):
        raw = architecture_map
    elif isinstance(architecture_map, dict):
        raw = architecture_map.get("components") or []
    else:
        raw = getattr(architecture_map, "components", None) or []
    return [_as_dict(c) for c in raw]


def _sel_list(selection: Any, selections: Any) -> list[dict[str, Any]]:
    if selections:
        return [s for s in selections if isinstance(s, dict)]
    if isinstance(selection, dict):
        return [selection]
    return []


def _selected_ids(selection: Any, selections: Any) -> set[str]:
    return {str(s["id"]) for s in _sel_list(selection, selections) if s.get("id")}


def _query_text(question: str, selection: Any, selections: Any) -> str:
    parts = [question or ""]
    for sel in _sel_list(selection, selections):
        for key in ("id", "name", "label", "purpose", "file"):
            if sel.get(key):
                parts.append(str(sel[key]))
        tech = sel.get("tech") or []
        if tech:
            parts.append(" ".join(str(t) for t in tech))
    return " ".join(parts)


def _doc_tokens(component: dict[str, Any]) -> list[str]:
    ident = str(component.get("id") or "")
    name = str(component.get("name") or "")
    purpose = str(component.get("purpose") or "")
    tech = " ".join(str(t) for t in (component.get("tech") or []))
    # Repeat id/name so BM25 treats them as heavier fields than purpose.
    return tokenize(f"{ident} {ident} {name} {name} {name} {purpose} {tech} {tech}")


def _hit(component: dict[str, Any], score: float) -> ComponentHit:
    files = tuple(str(p) for p in (component.get("files") or []) if str(p).strip())
    tech = tuple(str(t) for t in (component.get("tech") or []) if str(t).strip())
    return ComponentHit(
        id=str(component.get("id") or ""),
        name=str(component.get("name") or ""),
        purpose=str(component.get("purpose") or ""),
        tech=tech,
        files=files,
        score=score,
    )


def rank_components(
    question: str,
    architecture_map: Any,
    selection: Any = None,
    selections: Any = None,
    cap: int = COMPONENT_CAP,
) -> list[ComponentHit]:
    """Rank map components by keyword overlap on name / purpose / tech."""
    corpus = components_of(architecture_map)
    if not corpus or cap <= 0:
        return []
    docs = [_doc_tokens(c) for c in corpus]
    df: Counter[str] = Counter()
    for tokens in docs:
        df.update(set(tokens))
    avgdl = sum(len(d) for d in docs) / len(docs)
    n_docs = len(docs)
    qtokens = tokenize(_query_text(question, selection, selections))
    selected = _selected_ids(selection, selections)
    if not qtokens and not selected:
        return []

    scored: list[tuple[float, dict[str, Any]]] = []
    for component, dtokens in zip(corpus, docs):
        tf = Counter(dtokens)
        dl = len(dtokens) or 1
        score = 0.0
        for tok in qtokens:
            freq = tf[tok]
            if not freq:
                continue
            n_qi = df[tok]
            idf = math.log(1 + (n_docs - n_qi + 0.5) / (n_qi + 0.5))
            denom = freq + _K1 * (1 - _B + _B * dl / avgdl)
            score += idf * (freq * (_K1 + 1)) / denom
        cid = str(component.get("id") or "")
        if cid in selected:
            score += _SELECT_BOOST
        scored.append((score, component))
    scored.sort(key=lambda item: (-item[0], item[1].get("id") or ""))

    hits: list[ComponentHit] = []
    for score, component in scored:
        cid = str(component.get("id") or "")
        if score <= 0 and cid not in selected:
            continue
        hits.append(_hit(component, score))
        if len(hits) >= cap:
            break
    return hits


def rank_files(
    question: str,
    architecture_map: Any,
    selection: Any = None,
    selections: Any = None,
    component_cap: int = COMPONENT_CAP,
    cap: int = FILE_CAP,
) -> list[FileHit]:
    """Take files from the top-ranked components, in rank order."""
    if cap <= 0:
        return []
    hits: list[FileHit] = []
    seen: set[str] = set()
    for component in rank_components(
        question, architecture_map, selection, selections, cap=component_cap,
    ):
        for path in component.files:
            if path in seen:
                continue
            seen.add(path)
            hits.append(FileHit(path=path, component_id=component.id, score=component.score))
            if len(hits) >= cap:
                return hits
    return hits


def retrieve(
    question: str,
    architecture_map: Any,
    selection: Any = None,
    selections: Any = None,
    component_cap: int = COMPONENT_CAP,
    file_cap: int = FILE_CAP,
) -> RetrieveResult:
    components = rank_components(
        question, architecture_map, selection, selections, cap=component_cap,
    )
    files = rank_files(
        question,
        architecture_map,
        selection,
        selections,
        component_cap=component_cap,
        cap=file_cap,
    )
    return RetrieveResult(components=tuple(components), files=tuple(files))


def format_hits(result: RetrieveResult) -> str:
    """Compact block for the QA user message (no live LLM)."""
    if not result.components and not result.files:
        return ""
    lines: list[str] = []
    for hit in result.components:
        tech = f" [{', '.join(hit.tech)}]" if hit.tech else ""
        lines.append(f"- {hit.id} ({hit.name}){tech}: {hit.purpose}")
        if hit.files:
            lines.append("  files: " + ", ".join(hit.files))
    if result.files:
        lines.append("Top files: " + ", ".join(f.path for f in result.files))
    return "\n".join(lines)
