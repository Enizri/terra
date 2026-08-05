"""System prompt and fact rendering for the architecture map task."""

import posixpath

from ..models import ScanResult

# The file list is the bulk of the prompt and has to leave room inside
# the context for the system prompt, a retry, and the answer itself.
MAX_PROMPT_PATHS = 1200
MAX_FILES_CHARS = 16000
MAX_DEPS_PER_MANIFEST = 30

SYSTEM_PROMPT = """You explain software projects to people who cannot read code: founders, product managers, designers, and new joiners on their first day.

You are given verified facts about one repository — its languages, its dependencies, and a list of real file paths. Turn those facts into a map of the project. Every claim you make must be supported by the facts you were given.

Rules:
- "description" is one or two sentences about what this product does for the people who use it. Describe the product, never the repository, the files, or this map. Good: "Self-hosted note-taking app built for quick capture, markdown-native, with the data staying under the user's control."
- "kind" is a short phrase naming what sort of software this is: "Self-hosted web application", "Command-line tool", "Mobile app", "Developer library".
- Produce 8 to 15 components. A component is a part of the product a non-engineer could name and care about ("Memo Editor", "Authentication", "Data Storage") — not a single file, not a programming language, not a build tool.
- Every component needs an "id": a short lowercase handle you invent, made of letters and dots, such as "web", "api", "auth", "data" or "runtime". An id is never empty, never a sentence, and never the same as another component's id.
- "name" is the human label ("Memo Editor"). "id" is the handle ("web.editor"). They are different fields and both are required.
- Start with 5 to 8 top-level components that together cover the whole product. A top-level component sets "parent_id" to the empty string "" and has a one-word id: "web", "api", "auth", "data", "runtime".
- Then add sub-parts of those. A sub-part sets "parent_id" to a top-level id it is part of, and its own id is that parent id, a dot, and one word: "web.editor", "data.migrations". Never go deeper than that — "web.editor.components.preview" is wrong, and a parent_id must always name a component you actually listed.
- Group by what a part does for the user, not by technology. One "Data Storage" component beats separate components for MySQL, Postgres and the cache.
- "purpose" is one or two sentences of plain English saying what this part does for the user. No class names, no file names, no framework names, no jargon.
  Good: "The writing surface: markdown editing with autocomplete, syntax highlighting and attachments."
  Bad:  "Implements the MemoEditor React component tree and its CodeMirror extensions."
- A purpose must name the actual things this project handles — notes, attachments, tags, users, payments, whatever it really is. If a sentence would fit any other project on earth, it is wrong and you must rewrite it.
  Bad: "Handles data storage and retrieval for the application." Good: "Saves every note, tag and attachment, and finds them again when you search."
  Bad: "Provides the server-side logic and API for the application." Good: "Answers the app's requests: fetching notes, saving edits, checking who is allowed to do what."
- "tech" lists notable technologies for that component, taken from the dependency lists. Use an empty array when you are not sure.
- "files" lists REAL paths copied exactly from the FILES section. Use a directory path ending in "/" when a whole directory belongs to the component; that is usually the best answer. Never invent a path and never guess at one.
- "suggested_questions" are 5 questions a newcomer would genuinely ask about THIS project, answerable from this map.

Relationships — this is the part that makes the map useful, so do it properly:
- "from" and "to" are component ids you defined above ("web", "data"), never names and never file paths. "because" is one short piece of evidence naming the real file or directory that shows the connection.
- FIRST, trace the main path a user's action takes through the system, and write one relationship for each hop. In almost every web project that chain is: the frontend calls the server, the server checks authentication, and the server reads and writes storage. Write those backbone links before anything else.
  Example of the shape wanted, for a project with components "web", "server", "auth" and "data":
    {"from": "web", "to": "server", "type": "calls", "because": ["web/src/ fetches from the endpoints defined in server/router/"]}
    {"from": "server", "to": "auth", "type": "guarded_by", "because": ["server/router/api/v1/authz.go checks every request"]}
    {"from": "server", "to": "data", "type": "reads_writes", "because": ["store/memo.go saves and loads notes"]}
- THEN add the rest. Every top-level component you listed must appear in at least one relationship, as "from" or as "to". A component nothing connects to is a component you should not have created.
- Connect top-level components to each other. Links between a parent and its own sub-part are obvious and nearly worthless — do not fill the list with them.

Return only the JSON object."""


def build_prompt(res: ScanResult) -> str:
    """Renders the scan into the facts message. Deliberately terse: the
    product model is a small local model with a finite context."""
    parts = [
        f"PROJECT\nname: {res.name}\nrepository: {res.repository_url}\n"
        f"source files: {res.stats.source_files}\n"
        f"top-level dirs: {', '.join(res.stats.top_level_dirs)}\n"
    ]

    if res.languages:
        langs = ", ".join(f"{l.name} ({l.files} files)" for l in res.languages)
        parts.append(f"languages: {langs}\n")

    if res.tree:
        parts.append("\nDIRECTORIES (files, languages)\n")
        for d in res.tree:
            parts.append(f"{d.path}  {d.files}  {', '.join(d.languages)}\n")

    if res.dependencies:
        parts.append("\nDEPENDENCIES\n")
        for m in res.dependencies:
            names, extra = m.names, ""
            if len(names) > MAX_DEPS_PER_MANIFEST:
                extra = f" (+{len(names) - MAX_DEPS_PER_MANIFEST} more)"
                names = names[:MAX_DEPS_PER_MANIFEST]
            parts.append(f"{m.manifest} [{m.ecosystem}]: {', '.join(names)}{extra}\n")

    parts.append("\nFILES (real paths, grouped by directory — quote these exactly)\n")
    parts.append(file_section(res.files))
    return "".join(parts)


def file_section(all_paths: list[str]) -> str:
    """Groups paths under their directory so each directory prefix is written
    once, then truncates on a character budget."""
    paths, note = sample_paths(all_paths, MAX_PROMPT_PATHS)

    by_dir: dict[str, list[str]] = {}
    for p in paths:
        d = posixpath.dirname(p) or "."
        by_dir.setdefault(d, []).append(posixpath.basename(p))

    out = []
    length = 0
    omitted = 0
    for d in sorted(by_dir):
        # Root-level files are listed bare: their path is just the filename.
        line = f"{d}/: {', '.join(by_dir[d])}\n"
        if d == ".":
            line = ", ".join(by_dir[d]) + "\n"
        if length + len(line) > MAX_FILES_CHARS:
            omitted += len(by_dir[d])
            continue
        out.append(line)
        length += len(line)
    if omitted > 0:
        out.append(f"({omitted} further files omitted)\n")
    if note:
        out.append(f"({note})\n")
    return "".join(out)


def sample_paths(all_paths: list[str], max_files: int) -> tuple[list[str], str]:
    """Returns all paths when there are few enough, otherwise an even
    per-directory sample so every part of the tree stays represented.
    Port of scan.SamplePaths — the prompt caps at 1200 while the scan caps
    at 4000, so the analyzer needs its own copy."""
    if len(all_paths) <= max_files:
        return all_paths, ""
    by_dir: dict[str, list[str]] = {}
    for p in all_paths:
        by_dir.setdefault(posixpath.dirname(p) or ".", []).append(p)
    per = max(1, max_files // len(by_dir))
    files: list[str] = []
    for group in by_dir.values():
        files.extend(group[:per])
    files.sort()
    if len(files) > max_files:
        files = files[:max_files]
    return files, f"showing {len(files)} of {len(all_paths)} source files (up to {per} per directory)"
