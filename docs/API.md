# Commands and API

## Web routes

| Page | Purpose |
|---|---|
| `/` | Marketing page with a scripted workspace demonstration and capability previews |
| `/about` | What Terra does and the planned team workflow, marked **Coming soon** |
| `/new` | Creates a workspace URL at `/new/s/:slug` |
| `/new/s/:slug` | Repository intake, model picker, architecture map, history, Ask, and preview |

The marketing demonstrations include illustrative interactions; they are not a
complete inventory of implemented workspace features.

Saved analyses live in SQLite. The workspace lists recent analyses, can reopen or
delete them, and automatically opens the newest one when entering an empty
workspace. The URL slug is not a server-side session: chat, selections, and view
state are temporary. Model preferences and provider keys are stored in the browser.

## Make targets and CLI

| Command | What it does |
|---|---|
| `make venv` / `make venv-local` | Install Python services and dev tools; the latter adds the local GGUF runtime |
| `make dev` / `make dev-api` | Local stack, with or without the web UI |
| `make up` / `make up-llm` / `make down` | Start Compose, include its local LLM profile, or stop containers |
| `make build-web` | Type-check and build the web UI into `apps/web/dist` |
| `make check` | Contract checks, fixture sync, Go/Python/web tests, and lint |
| `make test` / `make eval` | Default tests, or analyzer harness evals only |
| `make smoke` | Opt-in Compose end-to-end suite (`TERRA_SMOKE=1`) |
| `make sync-fixtures` | Copy the golden map to the web's bundled fixture |
| `terra scan <url>` / `terra map <url>` | Deterministic scan, or scan + analysis + optional SQLite storage |
| `terra serve` | Serve the API; `--addr`, `--db`, and `--static` configure listening, storage, and built UI |

`scan` reads a GitHub tarball without a local Git clone or model call. `map` also
calls the analyzer and stores its result in `terra.db` in the command's working
directory. Use `--db ''` to skip storage or `--db /path/to/terra.db` to choose it.

## HTTP examples

Load the same token used by the API into your shell:

```sh
set -a
. ./.env
set +a
curl -sS -X POST http://127.0.0.1:8080/analyze \
  -H "Authorization: Bearer ${TERRA_TOKEN:-}" \
  -H 'Content-Type: application/json' \
  -d '{"repo_url":"https://github.com/usememos/memos"}'
curl -sS -H "Authorization: Bearer ${TERRA_TOKEN:-}" http://127.0.0.1:8080/analyses
```

`POST /analyze` uses the analyzer's configured model directly; it has no picker
step and can spend provider tokens. With `TERRA_REQUIRE_MODEL=1`, use the
model-aware `/jobs/analyze` endpoint instead.

## Go API routes

Registered in
[`backend/api/internal/server/server.go`](../backend/api/internal/server/server.go):

| Routes | Purpose |
|---|---|
| `GET /healthz`, `/models`, `/host/capabilities` | Open health and model-picker metadata |
| `POST /analyze` | Synchronous analysis with the operator-configured model |
| `POST /jobs/probe`, `/jobs/analyze`, `/jobs/ask`, `/jobs/agent` | Background scan, analysis, QA, or read-only guide |
| `GET /jobs/{id}/events`, `POST /jobs/{id}/cancel` | NDJSON events and cancellation |
| `GET /analyses`, `GET /analyses/{id}`, `DELETE /analyses/{id}` | List, retrieve, or delete stored maps |
| `POST /preview`, `/jobs/preview` | Start or reuse preview, synchronously or as a job |
| `POST /jobs/preview/test`, `/jobs/preview/cli` | Run repository tests or its CLI |
| `POST /preview/patch`, `/preview/restart` | Modify the preview checkout or restart it |
| `GET /preview/routes`, `POST /preview/probe` | Inspect routes and send an API-console request |
| `POST /ask`, `GET /files` | Synchronous QA and source-file reads |
| `GET /traces`, `POST /traces/ingest` | SSE preview trace stream and trace ingestion |

## Analyzer and sidecar

The analyzer on `8010` exposes `GET /healthz`, `GET /tasks`, `POST /analyze`
(the Go-to-Python contract), and `POST /tasks/{name}`. Registered tasks are
`architecture`, `qa`, `agent`, and `editor`. Requests accept model routing fields
`model`, `base_url`, and `api_key`. Agent/editor responses stream NDJSON progress
and a final answer. The editor can call Go's patch/restart endpoints; it is not
exposed through the workspace's read-only `/jobs/agent` route.

The local sidecar on `8020` exposes `GET /healthz`, `GET /v1/models`,
`POST /v1/chat/completions`, `GET /admin/status`, `POST /admin/load`, and
`POST /admin/cancel`. Status reports `ready`, `loading`, `error`, or `empty`.
Loading returns immediately; requesting the same model reuses its load, while
choosing another supersedes the previous request. Cancellation prevents an
abandoned result from being installed, although its download may still finish.

## Choosing a model in the workspace

A probe stops at the model gate before inference unless the current commit already
has a stored map. Job creation and event streaming are separate HTTP requests:

```text
POST /jobs/probe {repo_url} → {job_id}
GET /jobs/{job_id}/events → NDJSON: fetch → [recommend] → scan → done
  done contains probe_id + repository/recommendation, or an existing map

User selects a model and continues

POST /jobs/analyze {repo_url, probe_id, model_id, api_key?} → {job_id}
GET /jobs/{job_id}/events → NDJSON: [scan] → [ensure_model] → analyze → store → done
POST /jobs/{job_id}/cancel → cancel the running job
```

- **Catalog:** `GET /models` returns the static allowlist in
  [`backend/api/internal/catalog/catalog.go`](../backend/api/internal/catalog/catalog.go).
  Catalog IDs such as `openai-gpt-5.4-mini` differ from provider model IDs such as
  `gpt-5.4-mini`.
- **Host fit:** `GET /host/capabilities` reports RAM and accelerator information.
  Both the picker and API reject local choices that do not meet eligibility rules.
- **Local models:** analyze asks the sidecar to load the selected weights and
  streams `ensure_model` progress. One sidecar serves one loaded model at a time.
- **Hosted models:** keys live in browser `localStorage` under
  `terra_key_<provider>` and accompany analyze/Ask requests. They are forwarded to
  the provider, not stored in SQLite or job events; provider errors are scrubbed.
- **Ask:** the workspace uses `/jobs/agent`, a read-only guide, with the selected
  model. Opening a saved map keeps the session's model choice. Ask does not load
  local weights; after a sidecar restart or model switch, ensure the chosen model
  is available before asking.
- **Fallback:** callers without `model_id` use the analyzer's `TERRA_LLM_*`
  configuration unless the API requires an explicit model. The CLI uses this
  fallback and can override the provider model with `--model`.

Probe results expire from memory after 15 minutes; analyze rescans if needed.
Model preferences persist in the browser, independently of stored analyses.
