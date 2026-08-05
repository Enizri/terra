"""Validation and repair of the model's draft, ported from internal/graph/validate.go."""

from .models import Draft, ScanResult
from .schema import IMPORTANCE_VALUES, TYPE_VALUES


def known_paths(res: ScanResult) -> set[str]:
    """The set of every real file and directory in the scan, used to reject
    paths the model invented.
    ponytail: a file dropped by the scan's own sampling is not in this set, so
    a component citing it loses that one path. Directories are never sampled
    out, and directories are what components usually cite."""
    return set(res.files) | set(res.dirs)


def validate(d: Draft, known: set[str], strict: bool) -> tuple[list[str], list[str]]:
    """Normalizes a draft in place and reports what it had to change.
    Anything unusable is dropped either way; strict decides whether those
    drops are reported as errors (worth another attempt from the model) or as
    warnings (accepted, this is the best we are going to get).
    Returns (warnings, errors)."""
    issues: list[str] = []

    seen: set[str] = set()
    kept = []
    for c in d.components:
        c.id = c.id.strip()
        if not c.id:
            issues.append(f'dropped a component with an empty id (name "{c.name}")')
            continue
        if c.id in seen:
            issues.append(f'dropped duplicate component id "{c.id}"')
            continue
        seen.add(c.id)

        if not c.name:
            issues.append(f'component "{c.id}" has no name')
        if not c.purpose:
            issues.append(f'component "{c.id}" has no purpose')
        if c.importance not in IMPORTANCE_VALUES:
            issues.append(f'component "{c.id}" had importance "{c.importance}", set to medium '
                          f'(allowed: {", ".join(IMPORTANCE_VALUES)})')
            c.importance = "medium"
        if c.type not in TYPE_VALUES:
            issues.append(f'component "{c.id}" had type "{c.type}", set to backend '
                          f'(allowed: {", ".join(TYPE_VALUES)})')
            c.type = "backend"

        files = []
        for f in c.files:
            clean = clean_path(f)
            if clean.removesuffix("/") in known:
                files.append(clean)
            else:
                issues.append(f'component "{c.id}" cites "{f}", which does not exist in the repository')
        c.files = files
        kept.append(c)
    d.components = kept

    # parent_id resolves only against components that survived above.
    for c in d.components:
        if c.parent_id is None or not c.parent_id.strip():
            # An id like "web.editor" already names its parent, so take the
            # model at its word when it left parent_id blank.
            c.parent_id = None
            at = c.id.rfind(".")
            if at > 0 and c.id[:at] in seen:
                c.parent_id = c.id[:at]
            continue
        p = c.parent_id.strip()
        if p == c.id:
            issues.append(f'component "{c.id}" is its own parent, made top-level')
            c.parent_id = None
        elif p not in seen:
            issues.append(f'component "{c.id}" has parent "{p}", which is not a component; made top-level')
            c.parent_id = None
        else:
            c.parent_id = p

    rels = []
    for r in d.relationships:
        r.from_, r.to = r.from_.strip(), r.to.strip()
        if r.from_ not in seen:
            issues.append(f'dropped relationship from unknown component "{r.from_}"')
        elif r.to not in seen:
            issues.append(f'dropped relationship to unknown component "{r.to}"')
        elif r.from_ == r.to:
            issues.append(f'dropped relationship from "{r.from_}" to itself')
        else:
            rels.append(r)
    d.relationships = rels

    # A top-level component nothing connects to leaves a hole in the map: the
    # backbone (frontend -> server -> auth/storage) is the part readers came
    # for. Flagging it strictly spends the retry on getting those edges.
    connected = {r.from_ for r in d.relationships} | {r.to for r in d.relationships}
    for c in d.components:
        if c.parent_id is None and c.id not in connected:
            issues.append(f'top-level component "{c.id}" is not connected to anything; '
                          f'add a relationship showing what it calls, guards, or stores')

    if not d.components:
        issues.append("the map has no usable components")
        return [], issues
    if strict:
        return [], issues
    return issues, []


def clean_path(p: str) -> str:
    """Makes a model's path repo-relative, keeping the trailing slash that
    marks a directory. Models reliably write "/web/src/" for "web/src/"."""
    return p.strip().removeprefix("./").removeprefix("/")


def count_files(d: Draft, files: list[str]) -> None:
    """Fills in file_count from the scan, which knows the real numbers."""
    for c in d.components:
        matched: set[str] = set()
        for entry in c.files:
            p = clean_path(entry).removesuffix("/")
            for f in files:
                if f == p or f.startswith(p + "/"):
                    matched.add(f)
        c.file_count = len(matched)


def retry_message(errs: list[str]) -> str:
    """Turns validation errors into a correction the model can act on."""
    errs = sorted(errs)[:20]
    return ("Your previous answer had these problems:\n- " + "\n- ".join(errs) +
            "\n\nSend the whole JSON object again, corrected. Only use component ids you "
            "define yourself, and only use file paths copied exactly from the FILES list.")
