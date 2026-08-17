# Wire contracts

Canonical JSON shapes shared by Go, Python, and the web UI. Field names and
task names are part of the public surface — do not rename them casually.

## Layout

```
packages/contracts/
  analysis-map/v1.schema.json   # stored Architecture Map (projects.map_json / analyses.map_json)
  analyzer/v1/
    request.schema.json         # POST /analyze body (scan + model routing)
    response.schema.json        # POST /analyze response (draft + warnings)
  fixtures/                     # versioned examples used by make check-contracts
    analysis-map.v1.json        # symlink/copy of case-studies/memos.map.json (stripped)
    analyzer-request.v1.json
    analyzer-response.v1.json
```

## Ownership

| Contract | Written by | Read by |
|---|---|---|
| `analysis-map/v1` | Go store + CLI `terra map` | Go API, web UI, Ask context |
| `analyzer/v1` request | Go `analyzerclient` | Python analyzer |
| `analyzer/v1` response | Python `architecture` task | Go `analyzerclient` |

Enums for LLM generation live in the architecture task schema; the map contract
accepts the same values (plus free-form relationship verbs already in golden data).

## Compatibility rules

1. **Additive only inside a version.** New optional fields are fine. Renames and
   required-field changes need a new version (`v2`).
2. **Task names are stable.** `architecture` and `qa` must keep working.
3. **JSON field names match the golden fixtures.** Language-native types in Go,
   Python, and TypeScript mirror these schemas by hand; `make check-contracts`
   catches drift.
4. **SQLite stores `map_version`.** Readers upgrade older payloads in memory;
   unsupported future versions fail with a precise error.

## Checklist: changing a field

1. Update the relevant schema under `packages/contracts/`.
2. Update Go types (`backend/api/internal/analysis` or `backend/api/internal/scan`).
3. Update Python models (`terra_analyzer` contracts / task models).
4. Update TypeScript types (`apps/web/src/features/...` or shared map types).
5. Update `case-studies/memos.map.json` (and run `make sync-fixtures` if the map changed).
6. Update `packages/contracts/fixtures/` examples if shapes changed.
7. Run `make check-contracts` and `make check`.
