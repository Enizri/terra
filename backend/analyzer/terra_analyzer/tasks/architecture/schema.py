"""Draft enums and JSON schema shared with validate.py."""

IMPORTANCE_VALUES = ["critical", "high", "medium", "low"]
TYPE_VALUES = ["frontend", "backend", "database", "infrastructure"]
# Wire contract allows free-form verbs; schema pins these for small-model reliability.
RELATION_VERBS = [
    "calls", "exposes", "uses", "reads", "reads_writes",
    "guarded_by", "notifies", "hosts", "initializes", "upgraded_by",
]

# Constrains generation to the Draft shape (server-side decoding).
DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        # Upper bounds match what prompt.py already asks for in prose ("one or
        # two sentences", "a short phrase"). Unbounded strings are what let a
        # small model ramble past MAX_OUTPUT_TOKENS and fail the whole job:
        # the grammar can only hold a field to a length the schema states.
        "description": {"type": "string", "maxLength": 400},
        "kind": {"type": "string", "maxLength": 60},
        "components": {
            "type": "array",
            "minItems": 6,
            "maxItems": 15,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 2, "maxLength": 30},
                    "parent_id": {"type": "string", "maxLength": 30},
                    "name": {"type": "string", "minLength": 2, "maxLength": 60},
                    "purpose": {"type": "string", "minLength": 20, "maxLength": 300},
                    "importance": {"type": "string", "enum": IMPORTANCE_VALUES},
                    "type": {"type": "string", "enum": TYPE_VALUES},
                    "tech": {"type": "array", "maxItems": 8, "items": {"type": "string", "maxLength": 40}},
                    "files": {"type": "array", "minItems": 1, "maxItems": 8, "items": {"type": "string", "maxLength": 200}},
                },
                "required": ["id", "parent_id", "name", "purpose", "importance", "type", "tech", "files"],
            },
        },
        "relationships": {
            "type": "array",
            "minItems": 3,
            "maxItems": 18,
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string", "minLength": 2, "maxLength": 30},
                    "to": {"type": "string", "minLength": 2, "maxLength": 30},
                    "type": {"type": "string", "enum": RELATION_VERBS},
                    "because": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "string", "maxLength": 200}},
                },
                "required": ["from", "to", "type", "because"],
            },
        },
        "suggested_questions": {"type": "array", "minItems": 3, "maxItems": 6, "items": {"type": "string", "maxLength": 200}},
    },
    "required": ["description", "kind", "components", "relationships", "suggested_questions"],
}
