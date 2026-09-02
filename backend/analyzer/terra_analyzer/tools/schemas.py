"""Completions tool schemas. Effects run over HTTP (Go) or the in-payload map."""

LOOKUP_COMPONENT = {
    "type": "function",
    "function": {
        "name": "lookup_component",
        "description": (
            "Rank architecture-map components matching a question. "
            "Searches name, purpose, and tech on the map already in the Ask payload."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Question or keywords to match against components.",
                },
                "selection_id": {
                    "type": "string",
                    "description": "Currently selected component id, if any.",
                },
            },
            "required": ["query"],
        },
    },
}

RETRIEVE_FILES = {
    "type": "function",
    "function": {
        "name": "retrieve_files",
        "description": (
            "Rank evidence files from top-matching map components "
            "(components[].files on the Ask payload map)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Question or keywords used to rank components, then their files.",
                },
                "selection_id": {
                    "type": "string",
                    "description": "Currently selected component id, if any.",
                },
            },
            "required": ["query"],
        },
    },
}

READ_SNIPPET = {
    "type": "function",
    "function": {
        "name": "read_snippet",
        "description": (
            "Read a source file from the preview checkout via the Go API GET /files. "
            "Does not read the filesystem from Python."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Repository-relative file path.",
                },
                "repo_url": {
                    "type": "string",
                    "description": "Canonical repository URL (map.project.repository_url).",
                },
            },
            "required": ["path", "repo_url"],
        },
    },
}

APPLY_PATCH = {
    "type": "function",
    "function": {
        "name": "apply_patch",
        "description": (
            "Apply a unified diff to a file in the preview checkout via POST /preview/patch. "
            "Writes under the checkout root so Vite can HMR. Does not git commit. "
            "Does not write the filesystem from Python."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Repository-relative file path from the checkout root.",
                },
                "repo_url": {
                    "type": "string",
                    "description": "Canonical repository URL (map.project.repository_url).",
                },
                "unified_diff": {
                    "type": "string",
                    "description": "Unified diff to apply to that file.",
                },
            },
            "required": ["path", "repo_url", "unified_diff"],
        },
    },
}

PREVIEW_RESTART = {
    "type": "function",
    "function": {
        "name": "preview_restart",
        "description": (
            "Stop and start the live preview for a repository via POST /preview/restart. "
            "Use after apply_patch when HMR is not enough. Does not git commit."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "repo_url": {
                    "type": "string",
                    "description": "Canonical repository URL (map.project.repository_url).",
                },
            },
            "required": ["repo_url"],
        },
    },
}

GUIDE_TOOLS = [LOOKUP_COMPONENT, RETRIEVE_FILES, READ_SNIPPET]
GUIDE_TOOL_NAMES = tuple(tool["function"]["name"] for tool in GUIDE_TOOLS)

EDITOR_TOOLS = [*GUIDE_TOOLS, APPLY_PATCH, PREVIEW_RESTART]
EDITOR_TOOL_NAMES = tuple(tool["function"]["name"] for tool in EDITOR_TOOLS)
