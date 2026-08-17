# Terra production playground — Phase 1 design

**Date:** 2026-08-07  
**Status:** approved — Phase 1a + 1b verified (Compose healthz/token/SPA + Docker sibling preview for memos)  
**Scope:** Phase 1 only (deployable local Compose playground). Later phases are listed for sequencing, not implemented here.

## Decisions locked with the owner

| Topic | Choice |
|---|---|
| First deploy target | Local Docker Compose (promote later) |
| LLM | Hosted OpenAI-compatible by default; optional Compose profile `llm` for local HF |
| Access gate | Shared secret `TERRA_TOKEN` (OAuth later) |
| Live preview isolation | Docker sibling containers via host Docker socket |
| Overall shape | Monolith-ish: Go serves static web + API; analyzer/LLM internal |

## Goals

1. One command brings up a production-*shaped* stack on localhost.
2. Browser uses a single origin (`http://127.0.0.1:8080`) — no Vite proxy required.
3. Every existing product feature remains in scope across the roadmap (map, ask, live preview, traces, history). Phase 1 lands map + ask + history on Compose; preview gets a seam and Docker runner next (Phase 1b / Phase 6 equivalent), not a permanent feature cut.
4. Secrets stay out of images; config via env / `.env`.
5. Existing `make dev` local workflow keeps working for day-to-day coding.

## Non-goals (Phase 1)

- Public internet exposure / TLS
- GitHub OAuth, multi-tenant users
- Postgres / Redis / durable job queue
- Firecracker / microVM sandbox
- Replacing SQLite
- Changing the Go↔Python wire contract or analyzer prompts

## Target topology

```
Browser → 127.0.0.1:8080
              │
              │  Go (terra serve)
              │  - static web/dist (SPA)
              │  - HTTP API
              │  - preview reverse-proxy (existing)
              │
              ├─► analyzer:8010  (Compose network only)
              │         │
              │         ├─► TERRA_LLM_URL (hosted, default)
              │         └─► llm:8020/v1 (profile: llm)
              │
              ├─► volume: terra-data (terra.db, caches)
              └─► Docker Engine (socket) → preview-* containers (Phase 1b)
```

- Publish only `api` on `127.0.0.1:8080`.
- Do not publish `analyzer` or `llm` ports to the host in the default Compose file.
- Bind address configurable; default in Compose is loopback.

## Approach chosen

**Approach 1 — Monolith-ish Compose** (see conversation): deepen `cmd/terra` + `internal/server` to serve the built UI; package analyzer and optional LLM as sibling services. Rejected for Phase 1: edge Caddy (extra hop), Redis/Postgres microservices (premature).

## Module seams (Phase 1)

### `internal/server` — static + health + token gate

- `GET /healthz` → JSON `{status, service}` (liveness for Compose).
- `GET /` and SPA routes serve files from a configured static root (or embed). API routes keep precedence.
- Unknown non-API paths fall back to `index.html` for client routing (`/new/s/:slug`).
- When `TERRA_TOKEN` is non-empty, middleware requires `Authorization: Bearer <token>` or `X-Terra-Token: <token>` on expensive/mutating routes:
  - Protected: `POST /analyze`, `POST /jobs/*`, `POST /preview`, `POST /ask`, `GET /files`, `GET /traces`, `POST /traces/ingest`, `GET /analyses`, `GET /analyses/{id}`
  - Open: `GET /healthz`, static assets, SPA `index.html`
- If `TERRA_TOKEN` is empty, no gate (preserves current `make dev` DX). Document that empty token is local-only.

### `cmd/terra serve`

- New flag: `--static <dir>` (optional). When set (or when embedded FS is present), serve UI from there.
- Compose sets `--static` to the image path containing `web/dist`.
- Keep `--addr`, `--db`. Compose uses `--addr 0.0.0.0:8080` inside the container; host publish is `127.0.0.1:8080:8080`.

### Analyzer LLM client

- Add `TERRA_LLM_API_KEY` (optional). When set, send `Authorization: Bearer …` on Chat Completions and `/models` preflight.
- No other client changes; hosted providers stay drop-in via `TERRA_LLM_URL` + `TERRA_MODEL`.

### Preview seam (introduce in Phase 1, implement Docker runner in 1b)

- Extract a small interface used by `POST /preview` (conceptual):

  ```go
  type Runner interface {
      Start(ctx context.Context, repoURL string) (proxyURL string, err error)
      Lookup(repoURL string) (root, appDir string, ok bool)
      StopAll()
  }
  ```

- Default adapter remains today’s host-exec implementation for `make dev`.
- Compose / `TERRA_PREVIEW_MODE=docker` selects the Docker sibling adapter (Phase 1b).
- Phase 1a may leave host-exec as the only adapter but **must** introduce the seam so Phase 1b does not rewrite `server.go`.

### Web UI token UX

- On 401 from API, show a minimal unlock panel: paste token → `sessionStorage`.
- All `fetch` / `EventSource` clients attach the token header when present.
- No token baked into the JS bundle at build time.

## Compose & images

### Services

| Service | Image | Role |
|---|---|---|
| `api` | `Dockerfile.api` | Go binary + `web/dist` |
| `analyzer` | `Dockerfile.analyzer` | FastAPI analyzer (no torch) |
| `llm` | `Dockerfile.llm` | Optional local HF server (`profiles: [llm]`) |

### `Dockerfile.api` (multi-stage)

1. Node stage: `npm ci && npm run build` in `web/`.
2. Go stage: `go build -o /terra ./cmd/terra`.
3. Runtime: distroless or slim Debian; copy binary + `web/dist`; `ENTRYPOINT ["/terra", "serve", ...]`.

### `Dockerfile.analyzer`

- Python 3.12 slim; install `analyzer` without `[local]`; run uvicorn on `8010`.

### `Dockerfile.llm`

- Install `analyzer[local]`; run local_server on `8020`; large image acceptable; profile-gated.

### Volumes & env

- Volume `terra-data` → `/data` (`--db /data/terra.db`).
- `.env` (gitignored) from `.env.example`:
  - `TERRA_TOKEN`
  - `TERRA_LLM_URL` (default hosted URL or `http://llm:8020/v1` when using profile)
  - `TERRA_LLM_API_KEY`
  - `TERRA_MODEL`
  - `TERRA_ANALYZER_URL=http://analyzer:8010` (set in compose for `api`)
  - `GITHUB_TOKEN` (optional, higher GitHub rate limits)

### Make targets

- `make up` → `docker compose up --build -d`
- `make down` → `docker compose down`
- `make up-llm` → compose with `--profile llm`
- Keep `make dev` unchanged for non-Docker iteration.

## Data & reliability (minimal Phase 1)

- Keep SQLite file on the volume.
- Enable WAL + busy timeout when opening the DB (small change in `internal/store`) so concurrent job writes are less fragile.
- No migrations framework yet; document “breaking schema = new volume or delete db” until Phase 5.

## Jobs

- Remain in-process (`internal/job`). Document: single API replica only. Multi-instance is a later phase.

## Rate limits (Phase 1 stretch / Phase 3 start)

- Prefer a thin in-process limiter on protected routes (token bucket per IP) in the same PR series if cheap; otherwise first ticket of Phase 3.
- Hard requirement before any non-loopback publish: rate limits + non-empty `TERRA_TOKEN`.

## Testing & validation gate

Phase 1 is done when:

1. `docker compose up --build` reaches healthy `api` + `analyzer`.
2. `curl -sf http://127.0.0.1:8080/healthz` and analyzer health (via compose exec or internal) succeed.
3. With `TERRA_TOKEN` set, unauthenticated `POST /jobs/analyze` returns 401; with token, analyze completes against a hosted LLM (or `llm` profile).
4. Built UI loads from `:8080` (landing + workspace routes).
5. `make test` (Go + pytest + fixtures) still passes.
6. `make dev` still starts the four local processes without requiring Docker.

## Later phases (sequencing only)

| Phase | Focus | Depends on |
|---|---|---|
| **1b** | Docker sibling preview runner + idle TTL + concurrency cap | Phase 1 seam + docker.sock |
| **2** | Production LLM defaults, timeouts UX, cost caps | Phase 1 API key plumbing |
| **3** | Rate limits, body limits, queue depth, preview gated | Phase 1 token |
| **4** | GitHub OAuth, per-user history | Phase 3 |
| **5** | Migrations, metrics, structured logs, backups | Phase 1 volume |
| **6** | Harden preview (network policy, allowlists, memos adapter extraction) | Phase 1b |
| **7** | CI/CD, public TLS edge, polish | Phase 3+ |

## Risks & walls to flag early

1. **Docker socket trust** — API container with `docker.sock` can control the host engine. Acceptable for a solo playground on loopback; must not ship that posture to a shared public host without redesign.
2. **Preview base images** — need node/go toolchains inside sandbox images; cold start will be slow; cache strategy required in 1b.
3. **Hosted LLM JSON schema** — some providers reject strict `response_format.json_schema`; may need analyzer fallback (already partially tolerant). Validate against the chosen provider early.
4. **Embed vs bind-mount `web/dist`** — embed simplifies the image; bind-mount speeds UI iteration inside Compose. Prefer copy-into-image for Phase 1; keep `make dev` for UI HMR.

## Implementation order (for the plan after approval)

1. Analyzer `TERRA_LLM_API_KEY` + tests.
2. Store WAL/busy_timeout.
3. Server: `/healthz`, static SPA, token middleware + tests.
4. Web: token header + unlock UX.
5. Dockerfiles + `compose.yaml` + `.env.example` + Make targets + README section.
6. Preview `Runner` seam (host adapter = current code); no behavior change in `make dev`.
7. Validate with Compose + `make test`.
8. Stop for Phase 1b design/impl (Docker preview) — do not silently skip preview forever.

## Open questions (resolved)

- Deploy target: Compose local — **resolved**.
- LLM: hosted + profile — **resolved**.
- Auth: token — **resolved**.
- Preview: Docker siblings — **resolved** (implement in 1b after 1a green).
