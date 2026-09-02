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

GUIDE_TOOLS = [LOOKUP_COMPONENT, RETRIEVE_FILES, READ_SNIPPET]
GUIDE_TOOL_NAMES = tuple(
    tool["function"]["name"] for tool in GUIDE_TOOLS
)
