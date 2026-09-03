"""Architecture map fact rendering for the mapper user message."""

import posixpath

from ...contracts import ScanResult

# Leave room for system prompt, retry, and answer inside context.
MAX_PROMPT_PATHS = 1200
MAX_FILES_CHARS = 16000
MAX_DEPS_PER_MANIFEST = 30
MAX_MANIFESTS = 20


def build_prompt(res: ScanResult) -> str:
    """Render scan facts for the user message (kept short for local models)."""
    parts = [
        (
            f"PROJECT\nname: {res.name}\nrepository: {res.repository_url}\n"
            f"source files: {res.stats.source_files}\n"
            f"top-level dirs: {', '.join(res.stats.top_level_dirs)}\n"
        )
    ]

    if res.languages:
        langs = ", ".join(
            f"{language.name} ({language.files} files)" for language in res.languages
        )
        parts.append(f"languages: {langs}\n")

    if res.tree:
        parts.append("\nDIRECTORIES (files, languages)\n")
        for directory in res.tree:
            parts.append(
                f"{directory.path}  {directory.files}  {', '.join(directory.languages)}\n"
            )

    if res.dependencies:
        parts.append("\nDEPENDENCIES\n")
        shown = res.dependencies[:MAX_MANIFESTS]
        for manifest in shown:
            names, extra = manifest.names, ""
            if len(names) > MAX_DEPS_PER_MANIFEST:
                extra = f" (+{len(names) - MAX_DEPS_PER_MANIFEST} more)"
                names = names[:MAX_DEPS_PER_MANIFEST]
            parts.append(
                f"{manifest.manifest} [{manifest.ecosystem}]: {', '.join(names)}{extra}\n"
            )
        omitted = len(res.dependencies) - len(shown)
        if omitted > 0:
            parts.append(f"(+{omitted} more manifests omitted)\n")

    parts.append("\nFILES (real paths, grouped by directory — quote these exactly)\n")
    parts.append(file_section(res.files))
    return "".join(parts)


def file_section(all_paths: list[str]) -> str:
    """Group paths by directory; truncate on character budget."""
    paths, note = sample_paths(all_paths, MAX_PROMPT_PATHS)

    by_dir: dict[str, list[str]] = {}
    for path in paths:
        directory = posixpath.dirname(path) or "."
        by_dir.setdefault(directory, []).append(posixpath.basename(path))

    out = []
    length = 0
    omitted = 0
    for directory in sorted(by_dir):
        line = f"{directory}/: {', '.join(by_dir[directory])}\n"
        if directory == ".":
            line = ", ".join(by_dir[directory]) + "\n"
        if length + len(line) > MAX_FILES_CHARS:
            omitted += len(by_dir[directory])
            continue
        out.append(line)
        length += len(line)
    if omitted > 0:
        out.append(f"({omitted} further files omitted)\n")
    if note:
        out.append(f"({note})\n")
    return "".join(out)


def sample_paths(all_paths: list[str], max_files: int) -> tuple[list[str], str]:
    """Even per-directory sample (prompt cap 1200; scan caps at 4000)."""
    if len(all_paths) <= max_files:
        return all_paths, ""
    by_dir: dict[str, list[str]] = {}
    for path in all_paths:
        by_dir.setdefault(posixpath.dirname(path) or ".", []).append(path)
    per = max(1, max_files // len(by_dir))
    files: list[str] = []
    for group in by_dir.values():
        files.extend(group[:per])
    files.sort()
    if len(files) > max_files:
        files = files[:max_files]
    return files, f"showing {len(files)} of {len(all_paths)} source files (up to {per} per directory)"
