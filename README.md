# Terra

Turns a GitHub repository into an architecture map a non-engineer can read:
components, relationships, and the evidence for them.

## Status

Terra is pre-1.0 and built in the open. The full loop works end to end today:

**Paste or drop a GitHub URL → Terra fetches and scans it → recommends a model and
stops at a hard gate (no LLM call, no tokens spent, until you pick one) → analyzes
and streams the map in as it builds → you get a diagram whose every component links
back to the files that prove it → ask questions answered against that map → boot the
analyzed repo's own dev server in a live preview and select elements in it.**

Run it yourself with [Quickstart](#quickstart), or read a real map with no setup at
all: [`case-studies/memos.map.json`](case-studies/memos.map.json) is Terra's output
for [usememos/memos](https://github.com/usememos/memos), checked in as the golden
fixture the test suite runs against.

What is **not** done, so you don't go looking for it:

| Gap | Where |
|---|---|
| **Export JSON** and **Share map** are placeholder chips — visibly present, not wired | `apps/web/src/shared/shell/WorkspaceHeader.tsx` |
| The workspace session is not persisted. The URL slug is cosmetic, never sent to the server, and in-memory state is lost on reload | `apps/web/src/routes/workspace/cache.ts` |
| The step list under an Ask answer is a client-side animation, not real tool telemetry | `apps/web/src/features/ask/useAsk.ts` |
| Live preview supports `package.json` frontends only; other repos need host-exec `make dev` | `backend/api/internal/preview/` |
| No user accounts. `TERRA_TOKEN` is one shared secret, and empty leaves the API open | [`docs/SECURITY.md`](docs/SECURITY.md) |

Live preview runs the analyzed repository's own code — in host-exec mode, directly on
your machine. Read [`docs/SECURITY.md`](docs/SECURITY.md) before pointing it at a repository you
don't trust.

## Architecture

```
User (CLI / HTTP)
        |
        v
   Go backend  ──────────────► SQLite (terra.db)
   tarball ingest, scan, API, storage
        |
        | POST /analyze  {scan, model}
        v
   Python analyzer (FastAPI, :8010)
   analyzer tasks (architecture, …), validate, retry
        |
        | OpenAI-compatible POST /v1/chat/completions
        v
   Local GGUF server (:8020/v1)  — or any OpenAI-compatible endpoint
   llama.cpp (llama-cpp-python)
        |
        v
   Qwen2.5 0.5B Instruct Q4_K_M (HF cache)
```

Go and Python never import each other — they talk over HTTP. The analyzer
talks to the model only through the **OpenAI-compatible** Chat Completions API,
so a laptop HF server, vLLM, or a hosted provider are drop-in replacements.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the folder maps, the import
rules between them, and what to add for a new product under this repo. See
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for where new feature code goes,
`make check`, and PR expectations — GitHub default is **`main`**; branch from
**`staging`**, open PRs into **`staging`**, then promote **`staging` → `main`**.

## Quickstart

```sh
# once (compiles llama-cpp-python for local GGUF serving; needs cmake and a
# C++ compiler — the published wheels are corrupt). ~1 min.
make venv-local

# one terminal: llm (:8020) + analyzer (:8010) + api (:8080) + web (vite)
# opens http://localhost:5173/ (API GET / redirects there too)
# loads repo .env (GITHUB_TOKEN, TERRA_*, …) like Compose
make dev
# backend only (no web): make dev-api

# then, in another terminal:
(cd backend/api && go run ./cmd/terra map https://github.com/usememos/memos -o ../../memos.map.json)
# or hit the HTTP API:
curl -X POST localhost:8080/analyze -d '{"repo_url":"https://github.com/usememos/memos"}'
curl localhost:8080/analyses
curl localhost:8080/analyses/1
```

`make run-llm`, `make run-analyzer`, `make run-server`, and `make run-web` still
exist if you want to run one service alone.

Point `TERRA_LLM_URL` at any other OpenAI-compatible `/v1` endpoint (cloud, vLLM,
Ollama’s OpenAI mode) without changing analyzer code.

## Production-shaped playground (Docker Compose)

One origin on loopback: Go serves the built UI + API; analyzer (and optional local LLM)
stay on the Compose network.

Hosted-key quickstart:

```sh
cp .env.example .env
cat >> .env <<'EOF'
TERRA_TOKEN=change-me
TERRA_LLM_URL=https://api.openai.com/v1
TERRA_LLM_API_KEY=sk-...
TERRA_MODEL=gpt-4o-mini
EOF

make up          # api + analyzer → http://127.0.0.1:8080
docker compose logs analyzer | head -5   # must show model= and base_url=
curl -sf http://127.0.0.1:8080/healthz
make down
```

Local HF instead: `TERRA_LLM_URL=http://llm:8020/v1`, leave `TERRA_LLM_API_KEY`
empty, run `make up-llm`. Set `GITHUB_TOKEN` to a classic PAT with public-repo
read (`contents:read`); without it analyze shares GitHub’s ~60 REST req/hour/IP
quota and will rate-limit quickly (~5,000/hour with a token).

Troubleshooting (`docker compose logs analyzer`):

| Log line | Fix |
|---|---|
| `llm UNREACHABLE: …` | Wrong `TERRA_LLM_URL` or missing/invalid `TERRA_LLM_API_KEY` |
| `serving X, not Y` | `TERRA_MODEL` doesn't match what the endpoint serves |
| `points at localhost, but inside a container` | Use a hosted URL or `http://llm:8020/v1` — `localhost` inside Compose is the analyzer itself |

Open `http://127.0.0.1:8080/`. The workspace opens without pasting a token:
the API sets an HttpOnly cookie when it serves the UI (`make up`). `make dev`
forwards `TERRA_TOKEN` from `.env` through the Vite proxy.

`TERRA_TOKEN` is required for `make up` — the api container binds `0.0.0.0`
inside Compose and `terra serve` refuses a non-loopback bind with an empty
token. `make dev` (loopback) stays open.

**Live preview (Phase 1b):** Compose sets `TERRA_PREVIEW_MODE=docker`, mounts the
host Docker socket, and shares checkouts via the named `terra-data` volume
(`TERRA_CHECKOUT_VOLUME`) so Docker Desktop can mount them into siblings.
`POST /preview` starts a Node sibling and returns `/__live/{id}/` (same origin).
Caps: `TERRA_PREVIEW_MAX` (default 2), idle TTL `TERRA_PREVIEW_TTL` (default 30m).
Supports `package.json` frontends only; runfile/Go-only repos need `make dev`
(host-exec).

## Commands

| Command | What it does |
|---|---|
| `make dev` | Local full stack: LLM + analyzer + Go API + web |
| `make dev-api` | Same as `make dev` without the web UI |
| `make up` | Docker Compose: build/start api + analyzer (detached) |
| `make up-llm` | Same as `make up` with local HF `llm` profile |
| `make down` | Docker Compose: stop and remove containers |
| `make check` | Fixtures + Go/Python/web tests + lint (CI entry point) |
| `make test` | Fixtures + Go/Python/web tests |
| `make sync-fixtures` | Copy `case-studies/memos.map.json` → `apps/web/src/data/` |
| `terra scan <url>` | Clone + deterministic scan, JSON to stdout |
| `terra map <url>` | Scan, ask the analyzer for a map, store in `terra.db` |
| `terra serve` | HTTP API: `POST /jobs/probe`, `POST /jobs/analyze`, `GET /models`, `GET /host/capabilities`, `GET /analyses`, `POST /preview`, `POST /ask`, `GET /files` |

## Environment variables

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `TERRA_ANALYZER_URL` | Go | `http://localhost:8010` | Where the Python analyzer listens (`http://analyzer:8010` in Compose) |
| `TERRA_LLM_URL` | analyzer | `http://localhost:8020/v1` | OpenAI-compatible base URL (`…/v1`); Compose hosted or `http://llm:8020/v1` |
| `TERRA_LLM_API_KEY` | analyzer | _(empty)_ | Optional Bearer token for hosted providers |
| `TERRA_LLM_TIMEOUT` | analyzer | `600` | Seconds to wait for a chat/completions response (read timeout) |
| `TERRA_ANALYZE_TIMEOUT` | Go | `15m` | Wall-clock cap for one analyze job |
| `TERRA_RATE_LIMIT` | Go | `2` | Per-IP requests/sec on jobs/preview/ask (0 disables) |
| `TERRA_ANALYZE_CONCURRENCY` | Go | `4` | Max analyze jobs in flight; extra requests get 429 |
| `TERRA_MODEL` | analyzer + local LLM | `Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf` | GGUF quant as `<hf-repo>/<file>.gguf` |
| `TERRA_N_CTX` | local LLM | `18432` | Context window; must clear the largest prompt plus 4096 output tokens |
| `TERRA_N_GPU_LAYERS` | local LLM | `16` on GPU/Metal, `0` on CPU | Layers offloaded to the accelerator (`-1` = all, hottest) |
| `TERRA_TOKEN` | Go | _(empty)_ | Shared secret; empty leaves API open (local-only) |
| `TERRA_PREVIEW_MODE` | Go | _(empty)_ = host | `docker` for Compose sibling previews |
| `TERRA_CHECKOUT_DIR` | Go | user cache | Shared checkout root (Compose: `/data/checkouts`) |
| `TERRA_PUBLIC_URL` | Go | `http://127.0.0.1:8080` | Origin used in `/__live/...` preview URLs |
| `TERRA_PREVIEW_MAX` | Go | `2` | Max concurrent Docker previews |
| `TERRA_PREVIEW_TTL` | Go | `30m` | Idle TTL before a Docker preview is stopped |
| `TERRA_DEVICE` | local LLM + Go | `auto` (`mps` / `cuda` / `cpu`) | Device for `make run-llm` / Compose `llm`; also reported by `GET /host/capabilities` |
| `TERRA_LOCAL_LLM_URL` | Go | `http://localhost:8020` | Sidecar the workspace picker loads local models into (`http://llm:8020` in Compose) |
| `GITHUB_TOKEN` | Go scan | _(empty)_ | GitHub PAT for analyze/fetch; without it ~60 REST req/hour/IP, with it ~5,000/hour |

## Choosing a model in the workspace

Pasting a repo URL runs a **probe** first — fetch, scan, and a rule-based
recommendation — and then stops at a hard gate. No LLM call happens until you
press Continue.

```
POST /jobs/probe {repo_url}      → NDJSON: fetch → [recommend] → scan → done{probe_id, repo, recommendation}
                                   (a repo already mapped at this commit skips
                                    the gate: done carries the stored map)
   ↓ user picks a model
POST /jobs/analyze {repo_url, probe_id, model_id, api_key?}
                                 → NDJSON: [scan] → [ensure_model] → analyze → store → done
```

- **Catalog** — `GET /models` (open, no token) is a static allowlist shipped in
  `backend/api/internal/catalog`: local Hugging Face weights and curated remote
  OpenAI-compatible endpoints. IDs are provisional; the shape is not.
- **Host fit** — `GET /host/capabilities` (open) reports this machine's RAM and
  accelerator. Local models that cannot fit stay visible but disabled.
- **Local models** load on the Terra sidecar during analyze: the API calls
  `POST /admin/load {model_id}` and polls `GET /admin/status` until the weights
  are ready, streaming `ensure_model` events. No `.env` edit, no restart.
- **Remote models are BYOK.** The key is stored in the browser's `localStorage`
  under `terra_key_<provider>`, sent on the analyze request, forwarded to the
  provider, and dropped. It is never written to SQLite, a job event, or a log;
  provider errors are scrubbed before they become event labels.
- **Ask** reuses the model the workspace analyzed with. It does not run
  `ensure_model` — the weights are already loaded from the analyze that
  preceded it.
- **Operator fallback is unchanged.** A request without `model_id` (the CLI,
  `POST /analyze`, any older client) behaves exactly as before and uses
  `TERRA_LLM_URL` / `TERRA_MODEL` / `TERRA_LLM_API_KEY`.

Probe results are cached in memory for 15 minutes. If the gate sits open longer
than that, analyze rescans and says so.

## Analyzer HTTP surface

| Route | Purpose |
|---|---|
| `GET /healthz` | Status, model, whether the LLM `/v1/models` probe succeeded |
| `POST /analyze` | Architecture map (Go wire contract) |
| `GET /tasks` | Registered analyzer tasks |
| `POST /tasks/{name}` | Run a named task (`architecture`, …) |

`POST /analyze` and `POST /tasks/qa` accept optional `base_url` and `api_key`
alongside `model`, which override `TERRA_LLM_*` for that request only.

Local model sidecar (`make run-llm`, port 8020):

| Route | Purpose |
|---|---|
| `GET /admin/status` | `{model_id, device, state: ready\|loading\|error\|empty, error}` |
| `POST /admin/load` | Switch the served weights; returns immediately, 409 while another load is in flight |

## Tests

```sh
make check              # fixtures + Go + Python + web + lint (CI entry point)
make test               # fixtures + Go + Python + web (no lint)
make test-integration   # opt-in live suites (needs TERRA_INTEGRATION=1)
make sync-fixtures      # copy case-studies/memos.map.json → apps/web/src/data/
```

| Suite | Location | Default command |
|---|---|---|
| Go unit/integration | `backend/api/internal/*/*_test.go` (colocated) | `make test-go` |
| Python | `backend/analyzer/tests/` | `make test-py` (excludes `@pytest.mark.slow`) |
| Web logic | `apps/web/src/**/*.test.ts` | `make test-web` (`node --test`) |
| Web components | `apps/web/src/**/*.test.tsx` | part of `make test-web` (vitest) |
| Fixture sync | `case-studies/` ↔ `apps/web/src/data/` | `make test-fixtures` |
| Live GitHub | `backend/api/internal/scan/live_test.go` | `TERRA_INTEGRATION=1 make test-integration` |
| Live LLM | `backend/analyzer/tests/test_slow_llm.py` | same (`TERRA_SLOW=1` still works alone) |

The wire contract between Go and Python is the draft JSON in
`backend/analyzer/terra_analyzer/contracts/models.py` mirrored by `backend/api/internal/analysis/types.go`;
the enums and model JSON schema live only in
`backend/analyzer/terra_analyzer/tasks/architecture/schema.py`.
`case-studies/memos.map.json` is the golden answer key and is checked by
`backend/analyzer/tests/test_app.py` and `backend/api/internal/analysis/contract_test.go`.

## License

MIT — see [`LICENSE`](LICENSE).

The bundled celestial globe model is CC0 (Virtual Museums of Małopolska); its
provenance is recorded in `apps/web/public/terra/models/celestial-globe-license.txt`.
