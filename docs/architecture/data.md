# Data

## SQLite

Default file: `terra.db` (CLI `--db`; Docker volume `/data/terra.db`).

Current table (after migrations):

```sql
analyses (
  id, repo_url UNIQUE, name, commit_hash, scanned_at,
  map_json, map_version, created_at, updated_at
)
```

Plus `schema_migrations (version, name, applied_at)`.

Legacy databases with a `projects` table (no `schema_migrations`) are
bootstrapped and migrated in place — row IDs, URLs, commits, and maps are
preserved. Fixture: `internal/store/testdata/legacy_projects.db`.

## What lives in `map_json`

The full Architecture Map (`contracts/analysis-map/v1`): project metadata,
components, relationships, suggested questions. Components and relationships
are **not** normalized into separate tables.

**Normalize when** you need SQL filters/joins/indexes over components or
relationships (for example “all analyses that contain a Postgres component”).
Until then, keep the blob: one write, one read, one contract.

## Ephemeral stores (not SQLite)

| Store | Mechanism |
|---|---|
| Jobs | In-process hub |
| Probe cache | In-process TTL map |
| Traces | In-memory ring |
| Checkouts / runfiles | Filesystem under `~/.cache/terra/` |

## Map versioning

`map_version` is written on every save (`analysis.CurrentMapVersion`).
`DecodeMapJSON` upgrades known older versions in memory and rejects unsupported
future versions with a precise error.
