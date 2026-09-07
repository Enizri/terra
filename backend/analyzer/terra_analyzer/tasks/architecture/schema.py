"""Draft enums and JSON schema shared with validate.py."""

IMPORTANCE_VALUES = ["critical", "high", "medium", "low"]
TYPE_VALUES = ["frontend", "backend", "database", "infrastructure", "mobile", "desktop"]
# Wire contract allows free-form verbs; schema pins these for small-model reliability.
RELATION_VERBS = [
    "calls", "exposes", "uses", "reads", "reads_writes",
    "guarded_by", "notifies", "hosts", "initializes", "upgraded_by",
]

# Output tokens are the whole cost of a map. A grammar-constrained local model
# generates at roughly a third of its unconstrained speed, so on a laptop GPU
# every 100 characters of JSON is about a second of the user's wait — and a
# small model fills whatever ceiling the schema states rather than stopping
# when it has said enough. These bounds are therefore the generation budget,
# not defensive limits, and they are set from what the golden fixture actually
# needed (case-studies/memos.map.json: descriptions of 137 characters,
# purposes up to 157, at most 5 files and 6 technologies per component, and
# exactly one "because" on every one of its relationships) plus headroom.
#
# MAX_MAP_TOKENS is the matching hard stop: about twice the longest map
# observed against this schema, so a well-behaved run never reaches it and a
# runaway one fails in a minute instead of three.
MAX_MAP_TOKENS = 2000

# A citation the repository does not contain is the single most common reason
# a small model's first map fails validation, and every failure costs a whole
# second generation. When the caller can supply the repository's real
# directories, they become an enum: the decoding grammar then makes an
# invented path unrepresentable instead of merely detectable.
#
# The caps keep that enum inside what hosted structured-output endpoints
# accept (OpenAI allows 1000 enum values across a schema, and caps the total
# string length once a single property passes 250 values). A repository with
# more directories than this falls back to a plain bounded string and the
# usual repair path in validate.py.
MAX_PATH_CHOICES = 250
MAX_PATH_CHOICES_CHARS = 12_000


def draft_schema(paths: list[str] | None = None) -> dict:
    """The Draft JSON schema, optionally pinning file citations to real paths.

    paths is the repository's own directories (trailing slash included); an
    empty or oversized list leaves the free-form string in place.
    """
    if paths and len(paths) <= MAX_PATH_CHOICES and sum(map(len, paths)) <= MAX_PATH_CHOICES_CHARS:
        file_item: dict = {"type": "string", "enum": list(paths)}
    else:
        file_item = {"type": "string", "maxLength": 120}
    return {
        "type": "object",
        "properties": {
            "description": {"type": "string", "maxLength": 260},
            "kind": {"type": "string", "maxLength": 48},
            "components": {
                "type": "array",
                "minItems": 6,
                "maxItems": 12,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "minLength": 2, "maxLength": 28},
                        "parent_id": {"type": "string", "maxLength": 28},
                        "name": {"type": "string", "minLength": 2, "maxLength": 48},
                        "purpose": {"type": "string", "minLength": 20, "maxLength": 180},
                        "importance": {"type": "string", "enum": IMPORTANCE_VALUES},
                        "type": {"type": "string", "enum": TYPE_VALUES},
                        "tech": {"type": "array", "maxItems": 5, "items": {"type": "string", "maxLength": 24}},
                        "files": {"type": "array", "minItems": 1, "maxItems": 4, "items": file_item},
                    },
                    "required": ["id", "parent_id", "name", "purpose", "importance", "type", "tech", "files"],
                },
            },
            "relationships": {
                # The ceiling here is not what costs time — models reliably
                # write far fewer edges than components — so it stays wide
                # enough for the golden fixture's fifteen.
                "type": "array",
                "minItems": 3,
                "maxItems": 15,
                "items": {
                    "type": "object",
                    "properties": {
                        "from": {"type": "string", "minLength": 2, "maxLength": 28},
                        "to": {"type": "string", "minLength": 2, "maxLength": 28},
                        "type": {"type": "string", "enum": RELATION_VERBS},
                        # One piece of evidence, which is what the role prompt
                        # asks for and all the golden fixture ever uses.
                        "because": {"type": "array", "minItems": 1, "maxItems": 1, "items": {"type": "string", "maxLength": 140}},
                    },
                    "required": ["from", "to", "type", "because"],
                },
            },
            "suggested_questions": {"type": "array", "minItems": 3, "maxItems": 5, "items": {"type": "string", "maxLength": 140}},
        },
        "required": ["description", "kind", "components", "relationships", "suggested_questions"],
    }


# Constrains generation to the Draft shape (server-side decoding). This is the
# repository-agnostic form; the mapper builds a per-scan one with draft_schema.
DRAFT_SCHEMA = draft_schema()
