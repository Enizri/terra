# ADR 0002: Architecture maps as versioned JSON payloads

## Status

Accepted

## Context

Analyses need persistence. We could normalize components and relationships into
relational tables, or store the map as JSON.

## Decision

Store each Architecture Map as `analyses.map_json` with an explicit
`map_version`. Use transactional SQLite migrations for table shape. Do not
normalize graph nodes until a real query/indexing requirement appears.

## Consequences

- Simple cache and list/get APIs.
- Schema evolution is versioned and testable against legacy DB fixtures.
- Ad-hoc SQL over components is not available without loading JSON.
