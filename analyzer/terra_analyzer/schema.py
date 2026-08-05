"""Single source of truth for the draft enums and the JSON schema sent to the
model. validate.py checks against the same lists, so they cannot drift apart.
"""

IMPORTANCE_VALUES = ["critical", "high", "medium", "low"]
TYPE_VALUES = ["frontend", "backend", "database", "infrastructure"]
# Relationship verbs are free-form in the wire contract, but an unconstrained
# field makes a small model produce mush, so the schema pins these.
RELATION_VERBS = [
    "calls", "exposes", "uses", "reads", "reads_writes",
    "guarded_by", "notifies", "hosts", "initializes", "upgraded_by",
]

# Constrains generation to the shape of Draft. A JSON schema makes the server
# constrain decoding, which is what makes a 3B model reliable enough to use.
DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {"type": "string"},
        "kind": {"type": "string"},
        "components": {
            "type": "array",
            "minItems": 6,
            "maxItems": 15,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 2, "maxLength": 30},
                    "parent_id": {"type": "string", "maxLength": 30},
                    "name": {"type": "string", "minLength": 2},
                    "purpose": {"type": "string", "minLength": 20},
                    "importance": {"type": "string", "enum": IMPORTANCE_VALUES},
                    "type": {"type": "string", "enum": TYPE_VALUES},
                    "tech": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
                    "files": {"type": "array", "minItems": 1, "maxItems": 8, "items": {"type": "string"}},
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
                    "because": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "string"}},
                },
                "required": ["from", "to", "type", "because"],
            },
        },
        "suggested_questions": {"type": "array", "minItems": 3, "maxItems": 6, "items": {"type": "string"}},
    },
    "required": ["description", "kind", "components", "relationships", "suggested_questions"],
}
