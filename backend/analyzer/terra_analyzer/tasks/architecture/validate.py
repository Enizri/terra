"""Draft validation/repair (ported from internal/graph/validate.go)."""

from ...contracts import Draft, ScanResult
from .schema import IMPORTANCE_VALUES, TYPE_VALUES

# The map is drawn as three columns, and a card is only ever nested inside a
# parent from its own column. A child the model filed under another column is
# therefore invisible on the diagram, so it is repaired to top-level here.
COLUMN = {
    "frontend": "client",
    "mobile": "client",
    "desktop": "client",
    "backend": "work",
    "infrastructure": "work",
    "database": "storage",
}


def known_paths(res: ScanResult) -> set[str]:
    """Real scan files and dirs — used to reject invented paths."""
    return set(res.files) | set(res.dirs)


def path_choices(res: ScanResult, limit: int) -> list[str]:
    """Directories the model may cite, shallowest first, capped at limit.

    These become an enum in the decoding schema, so the order decides what a
    large repository loses: depth first, because a component a non-engineer
    would name lives near the top of the tree ("web/", "server/router/"), not
    eight levels down. Directories only — the role prompt already says a
    directory is usually the better citation, and enumerating every file would
    blow past what a hosted structured-output endpoint accepts.
    """
    dirs = sorted(res.dirs, key=lambda path: (path.count("/"), path))
    return [path + "/" for path in dirs[:limit]]


def validate(draft: Draft, known: set[str], strict: bool) -> tuple[list[str], list[str]]:
    """Normalize draft in place. strict=True → issues as errors (retry); else warnings.
    Returns (warnings, errors)."""
    issues: list[str] = []

    seen: set[str] = set()
    kept = []
    for component in draft.components:
        component.id = component.id.strip()
        if not component.id:
            issues.append(f'dropped a component with an empty id (name "{component.name}")')
            continue
        if component.id in seen:
            issues.append(f'dropped duplicate component id "{component.id}"')
            continue
        seen.add(component.id)

        if not component.name:
            issues.append(f'component "{component.id}" has no name')
        if not component.purpose:
            issues.append(f'component "{component.id}" has no purpose')
        if component.importance not in IMPORTANCE_VALUES:
            issues.append(f'component "{component.id}" had importance "{component.importance}", set to medium '
                          f'(allowed: {", ".join(IMPORTANCE_VALUES)})')
            component.importance = "medium"
        if component.type not in TYPE_VALUES:
            issues.append(f'component "{component.id}" had type "{component.type}", set to backend '
                          f'(allowed: {", ".join(TYPE_VALUES)})')
            component.type = "backend"

        files = []
        for path in component.files:
            clean = clean_path(path)
            if clean.removesuffix("/") in known:
                files.append(clean)
            else:
                issues.append(f'component "{component.id}" cites "{path}", which does not exist in the repository')
        component.files = files
        kept.append(component)
    draft.components = kept

    # parent_id must resolve against survivors only.
    type_of = {component.id: component.type for component in draft.components}
    for component in draft.components:
        if component.parent_id is None or not component.parent_id.strip():
            # Infer parent from dotted id when model left parent_id blank.
            component.parent_id = None
            at = component.id.rfind(".")
            if at > 0 and component.id[:at] in seen:
                component.parent_id = component.id[:at]
            continue
        parent = component.parent_id.strip()
        if parent == component.id:
            issues.append(f'component "{component.id}" is its own parent, made top-level')
            component.parent_id = None
        elif parent not in seen:
            issues.append(f'component "{component.id}" has parent "{parent}", which is not a component; made top-level')
            component.parent_id = None
        elif COLUMN.get(type_of[parent]) != COLUMN.get(component.type):
            issues.append(
                f'component "{component.id}" ({component.type}) has parent "{parent}" '
                f'({type_of[parent]}); nest a component only inside one of its own kind, '
                f"or leave parent_id null — made top-level"
            )
            component.parent_id = None
        else:
            component.parent_id = parent

    # A hierarchy that leaves one card is a map nobody can read: the diagram
    # draws top-level components, so everything else vanishes.
    if len(draft.components) > 1 and sum(c.parent_id is None for c in draft.components) < 2:
        issues.append(
            "every component is nested under one parent, so the map would draw a "
            "single card; leave parent_id null unless a component is genuinely "
            "part of another"
        )
        for component in draft.components:
            component.parent_id = None

    rels = []
    for relationship in draft.relationships:
        relationship.from_, relationship.to = relationship.from_.strip(), relationship.to.strip()
        if relationship.from_ not in seen:
            issues.append(f'dropped relationship from unknown component "{relationship.from_}"')
        elif relationship.to not in seen:
            issues.append(f'dropped relationship to unknown component "{relationship.to}"')
        elif relationship.from_ == relationship.to:
            issues.append(f'dropped relationship from "{relationship.from_}" to itself')
        else:
            rels.append(relationship)
    draft.relationships = rels

    # Unconnected top-level components are strict errors so the retry fills edges.
    connected = {relationship.from_ for relationship in draft.relationships} | {
        relationship.to for relationship in draft.relationships
    }
    for component in draft.components:
        if component.parent_id is None and component.id not in connected:
            issues.append(f'top-level component "{component.id}" is not connected to anything; '
                          f'add a relationship showing what it calls, guards, or stores')

    if not draft.components:
        issues.append("the map has no usable components")
        return [], issues
    if strict:
        return [], issues
    return issues, []


# A second generation costs exactly as long as the first, which on a local
# model is most of the user's wait. validate() already repairs everything it
# can — dropping invented citations, un-nesting a child filed under the wrong
# column, deleting edges that name components nobody defined — so a draft with
# issues is usually still a map worth reading. Only these thresholds, which
# describe a map that would be misleading rather than merely imperfect, are
# worth paying for a retry.
# Three cards is a complete small app (screens, logic, storage). The schema
# still asks the model for more; this floor is what survives repair.
MIN_COMPONENTS = 3
MIN_EVIDENCE_SHARE = 0.5


def unusable(draft: Draft) -> list[str]:
    """Reasons the repaired draft should not be shown at all (empty = ship it)."""
    reasons: list[str] = []
    if len(draft.components) < MIN_COMPONENTS:
        reasons.append(
            f"only {len(draft.components)} components survived validation; "
            f"a readable map needs at least {MIN_COMPONENTS}"
        )
    if not draft.relationships:
        reasons.append(
            "no relationship between any two components survived; a map with "
            "no edges shows nothing about how the parts fit together"
        )
    cited = sum(1 for component in draft.components if component.files)
    if draft.components and cited < len(draft.components) * MIN_EVIDENCE_SHARE:
        reasons.append(
            f"only {cited} of {len(draft.components)} components cite a real file "
            "or directory; every component has to link back to its evidence"
        )
    return reasons


def clean_path(path: str) -> str:
    """Repo-relative path; keep trailing slash for directories."""
    return path.strip().removeprefix("./").removeprefix("/")


def count_files(draft: Draft, files: list[str]) -> None:
    """Set file_count from the scan."""
    for component in draft.components:
        matched: set[str] = set()
        for entry in component.files:
            path = clean_path(entry).removesuffix("/")
            for file_path in files:
                if file_path == path or file_path.startswith(path + "/"):
                    matched.add(file_path)
        component.file_count = len(matched)


def retry_message(errs: list[str]) -> str:
    """Validation errors as a correction prompt for the model."""
    errs = sorted(errs)[:20]
    return ("Your previous answer had these problems:\n- " + "\n- ".join(errs) +
            "\n\nSend the whole JSON object again, corrected. Only use component ids you "
            "define yourself, and only use file paths copied exactly from the FILES list.")
