"""Draft validation/repair (ported from internal/graph/validate.go)."""

from .models import Draft, ScanResult
from .schema import IMPORTANCE_VALUES, TYPE_VALUES


def known_paths(res: ScanResult) -> set[str]:
    """Real scan files and dirs — used to reject invented paths."""
    return set(res.files) | set(res.dirs)


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
        else:
            component.parent_id = parent

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
