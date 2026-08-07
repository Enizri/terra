# Terra

Turns a GitHub repository into an architecture map a non-engineer can read:
components, relationships, and the evidence for them.

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
   agent tasks (architecture, …), validate, retry
        |
        | OpenAI-compatible POST /v1/chat/completions
        v
   Local HF server (:8020/v1)   — or any OpenAI-compatible endpoint
   Transformers + torch
        |
        v
   Qwen/Qwen2.5-0.5B-Instruct (HF cache)
```

Go and Python never import each other — they talk over HTTP. The analyzer
talks to the model only through the **OpenAI-compatible** Chat Completions API,
so a laptop HF server, vLLM, or a hosted provider are drop-in replacements.

`ARCHITECTURE.md` has the folder maps, the import rules between them, and what
to add for a new product under this repo.

## Quickstart

```sh
# once (adds torch + transformers for local serving)
make venv-local

# one terminal: llm (:8020) + analyzer (:8010) + api (:8080) + web (vite)
# opens http://localhost:5173/ (API GET / redirects there too)
make dev
# backend only (no web): make dev-api

# then, in another terminal:
go run ./cmd/terra map https://github.com/usememos/memos -o memos.map.json
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
empty, run `make up-llm`. Optional: `GITHUB_TOKEN` for higher GitHub rate limits.

Troubleshooting (`docker compose logs analyzer`):

| Log line | Fix |
|---|---|
| `llm UNREACHABLE: …` | Wrong `TERRA_LLM_URL` or missing/invalid `TERRA_LLM_API_KEY` |
| `serving X, not Y` | `TERRA_MODEL` doesn't match what the endpoint serves |
| `points at localhost, but inside a container` | Use a hosted URL or `http://llm:8020/v1` — `localhost` inside Compose is the analyzer itself |

Open `http://127.0.0.1:8080/`. If `TERRA_TOKEN` is set, paste it in the unlock
panel after a 401.

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
| `terra scan <url>` | Clone + deterministic scan, JSON to stdout |
| `terra map <url>` | Scan, ask the analyzer for a map, store in `terra.db` |
| `terra serve` | HTTP API: `POST /analyze`, `GET /analyses`, `GET /analyses/{id}`, `POST /preview`, `POST /ask`, `GET /files` |

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
| `TERRA_MODEL` | analyzer + local LLM | `Qwen/Qwen2.5-0.5B-Instruct` | Hugging Face model id or path |
| `TERRA_TOKEN` | Go | _(empty)_ | Shared secret; empty leaves API open (local-only) |
| `TERRA_PREVIEW_MODE` | Go | _(empty)_ = host | `docker` for Compose sibling previews |
| `TERRA_CHECKOUT_DIR` | Go | user cache | Shared checkout root (Compose: `/data/checkouts`) |
| `TERRA_PUBLIC_URL` | Go | `http://127.0.0.1:8080` | Origin used in `/__live/...` preview URLs |
| `TERRA_PREVIEW_MAX` | Go | `2` | Max concurrent Docker previews |
| `TERRA_PREVIEW_TTL` | Go | `30m` | Idle TTL before a Docker preview is stopped |
| `TERRA_DEVICE` | local LLM | `auto` (`mps` / `cuda` / `cpu`) | Torch device for `make run-llm` / Compose `llm` |
| `GITHUB_TOKEN` | Go scan | _(empty)_ | Optional; higher GitHub API rate limits |

## Analyzer HTTP surface

| Route | Purpose |
|---|---|
| `GET /healthz` | Status, model, whether the LLM `/v1/models` probe succeeded |
| `POST /analyze` | Architecture map (Go wire contract) |
| `GET /tasks` | Registered agent tasks |
| `POST /tasks/{name}` | Run a named task (`architecture`, …) |

## Tests

```sh
make test        # go test ./... + pytest (skips @pytest.mark.slow)
```

The wire contract between Go and Python is the draft JSON in
`analyzer/terra_analyzer/models.py` mirrored by `internal/graph/types.go`;
the enums and model JSON schema live only in `analyzer/terra_analyzer/schema.py`.
`case-studies/memos.map.json` is the golden answer key and is checked by
`analyzer/tests/test_app.py`.
