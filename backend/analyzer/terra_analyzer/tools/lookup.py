"""lookup_component / retrieve_files — rank the map already in the QA payload."""

from typing import Any

from ..retrieve import COMPONENT_CAP, FILE_CAP, retrieve


def _selection(selection_id: str = "") -> dict[str, str] | None:
    ident = (selection_id or "").strip()
    return {"id": ident} if ident else None


def lookup_component(
    architecture_map: Any,
    query: str,
    selection_id: str = "",
    cap: int = COMPONENT_CAP,
) -> list[dict[str, Any]]:
    hits = retrieve(
        query,
        architecture_map,
        selection=_selection(selection_id),
        component_cap=cap,
        file_cap=0,
    )
    return [
        {
            "id": hit.id,
            "name": hit.name,
            "purpose": hit.purpose,
            "tech": list(hit.tech),
            "files": list(hit.files),
            "score": hit.score,
        }
        for hit in hits.components
    ]


def retrieve_files(
    architecture_map: Any,
    query: str,
    selection_id: str = "",
    cap: int = FILE_CAP,
) -> list[dict[str, Any]]:
    hits = retrieve(
        query,
        architecture_map,
        selection=_selection(selection_id),
        file_cap=cap,
    )
    return [
        {"path": hit.path, "component_id": hit.component_id, "score": hit.score}
        for hit in hits.files
    ]
