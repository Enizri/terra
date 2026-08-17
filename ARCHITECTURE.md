# Terra architecture

How the pieces fit, which direction imports are allowed to point, and where new
code goes. `README.md` covers running it; [`CONTRIBUTING.md`](CONTRIBUTING.md)
covers the change recipes. Domain terms live in [`CONTEXT.md`](CONTEXT.md).

Deep dives: [`docs/architecture/modules.md`](docs/architecture/modules.md),
[`docs/architecture/data.md`](docs/architecture/data.md),
[`docs/architecture/contracts.md`](docs/architecture/contracts.md).

## The three processes

```
User (CLI / browser)
        |
        v
   Go backend (:8080)  ──────────────► SQLite (terra.db)
   tarball ingest, scan, HTTP API, storage
        |
        | POST /analyze  {scan, model}   (packages/contracts/analyzer/v1)
        v
   Python analyzer (FastAPI, :8010)
   tasks (architecture, qa), validate, retry
        |
        | OpenAI-compatible POST /v1/chat/completions
        v
   Local HF server (:8020/v1) — or any OpenAI-compatible endpoint
```

Two invariants hold everywhere:

1. **Go and Python never import each other.** They talk over HTTP.
2. **The analyzer reaches a model only through OpenAI-compatible Chat Completions.**

## Where does this change go?

| Change | Put it here |
|---|---|
| HTTP route / job streaming | `backend/api/internal/server/` (thin adapter) |
| Analyze pipeline (scan→map→store) | `backend/api/internal/analyze/` |
| Architecture map types / assemble | `backend/api/internal/analysis/` |
| Python HTTP client | `backend/api/internal/analyzerclient/` |
| SQLite / migrations | `backend/api/internal/store/` |
| Scan / deps / tarball | `backend/api/internal/scan/` |
| Analyzer task / schema / validate | `backend/analyzer/terra_analyzer/tasks/<name>/` |
| Analyzer HTTP | `backend/analyzer/terra_analyzer/api/` |
| Wire models | `backend/analyzer/terra_analyzer/contracts/` + root `packages/contracts/` |
| Local GGUF server | `backend/local-llm/terra_local_llm/` |
| Workspace UI pane | `apps/web/src/routes/workspace/` |
| Map diagram / map types | `apps/web/src/features/architecture-map/` |
| Analyze/ask/preview API clients | `apps/web/src/features/{analysis,ask,preview}/` |
| Shared chrome / CSS / http helpers | `apps/web/src/shared/` |
| Golden map | `case-studies/memos.map.json` → `make sync-fixtures` |

## Go — `github.com/Enizri/terra/backend/api`

Imports only ever point **down** this list:

| Package | Does |
|---|---|
| `backend/api/cmd/terra` | CLI composition root: `scan`, `map`, `serve` |
| `backend/api/internal/server` | HTTP-only handlers and middleware |
| `backend/api/internal/analyze` | Probe/analyze workflow |
| `backend/api/internal/store` | SQLite lifecycle, migrations, analysis persistence |
| `backend/api/internal/analyzerclient` | HTTP adapter to the Python analyzer |
| `backend/api/internal/analysis` | Map model, FromScan, Assemble, map_version decode |
| `backend/api/internal/preview` | Live preview boot + proxy |
| `backend/api/internal/catalog` | Static model allowlist |
| `backend/api/internal/config` | Every `TERRA_*` env var |
| `backend/api/internal/scan` | Tarball ingest (leaf) |

**No `internal` package imports `server`.** Enforced by `.golangci.yaml` depguard.

## Python — `backend/analyzer/` and `backend/local-llm/`

```
terra_analyzer/
  app.py              uvicorn entry (`app`, `create_app`)
  api/                FastAPI routes
  contracts/          Pydantic wire models
  tasks/              typed tasks (architecture, qa) + registry
  inference/          OpenAI-compatible client
../local-llm/
  terra_local_llm/    optional GGUF /v1 server (:8020)
```

Tasks are deterministic handlers — not autonomous agents. Register new ones in
`tasks/registry.py` `default_registry()`.

## Web — `apps/web/src`

```
app/          router + entry
routes/       page composition (landing, workspace)
features/     domain modules (analysis, ask, architecture-map, preview)
shared/       domain-neutral http, shell, styles, utilities
data/         committed fixtures (synced from case-studies/)
```

Import direction: `app/routes → features → shared`. Enforced by
`apps/web/src/boundaries.test.ts`.

## Contracts and fixtures

- Canonical schemas: [`packages/contracts/`](packages/contracts/README.md)
- Golden map: `case-studies/memos.map.json`
- Web copy: `apps/web/src/data/memos.map.json` via `make sync-fixtures`
- Gate: `make check-contracts` (part of `make check`)

## Verification

| Command | What it runs |
|---|---|
| `make check-contracts` | Versioned fixtures ↔ Go/Python/TS |
| `make test` | fixtures + Go + Python + web |
| `make lint` | golangci-lint + oxlint + Python lint |
| `make check` | contracts + test + lint (CI entry point) |

## Known warts

- Preview boot uses Go `backend/api/internal/runfile`, not a Python task.
- `backend/api/internal/preview` still carries memos-tuned demo helpers.
- Wire types are hand-mirrored; `make check-contracts` catches drift (no codegen yet).
- Components/relationships stay inside `map_json` until a real relational query need appears.
