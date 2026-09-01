# Workspace model selection — design

**Date:** 2026-08-09  
**Status:** draft — awaiting owner review  
**Scope:** Pre-analyze model picker in the workspace: local sidecar models + curated remote BYOK, hybrid recommendation, hard Continue gate. Terra-billed remotes are sequenced later, not built here.

## Decisions locked with the owner

| Topic | Choice |
|---|---|
| Local inference | Sidecar on the Terra host (existing HF/`make run-llm` shape), not browser WebGPU |
| Remote catalog | Curated providers/models only (no custom OpenAI-compatible URL in v1) |
| API keys | Browser-only (`localStorage` by provider); sent per analyze request; never stored server-side |
| Local catalog size | Medium curated set (~5–8) across fast / balanced / quality |
| Suggestion timing | Hybrid: provisional from GitHub metadata, refined after no-LLM scan |
| Host limits | Auto-detect on Terra host (RAM, device); filter/bias local picks |
| Confirm UX | Hard gate after probe; LLM analyze starts only on Continue |
| Job shape | Two-phase: **probe** then **analyze** (not a paused single job) |

## Goals

1. User pastes a repo URL, sees a **recommended model** that respects **repo complexity** and **machine fit**, then explicitly Continues.
2. Local choice downloads/loads on the host automatically during analyze (`ensure_model`) and exposes an OpenAI-compatible `/v1` endpoint without manual `.env` edits.
3. Remote choice prompts for that provider’s API key once (browser), then runs pay-as-you-go against the curated endpoint.
4. Analyzer keeps the Chat Completions contract; routing is catalog → base URL + model id (+ optional key).
5. Existing `make dev` / Compose paths keep working; env-only `TERRA_LLM_*` remains a fallback for operators.

## Non-goals (v1)

- Terra-billed proxy / subscription for remote models (later phase)
- Free-form custom base URL + arbitrary model id
- In-browser WebGPU / transformers.js inference
- Multi-user key vault, team sharing, encrypted server-side key store
- LLM-based model recommender (rules only in v1)
- Changing analyzer prompts or map schema beyond per-request model/URL/key wiring

## Approach chosen

**Two-phase jobs (probe → gate → analyze).**

Rejected:

- **Single paused job** — hard gate is natural in SSE, but paused workers, TTL, and reconnects are fragile.
- **Client-orchestrated micro-steps** — maximum UI control, but business flow and races leak into the frontend.

## Target flow

```
Browser
  │  paste repo URL
  ▼
POST /jobs/probe  ──SSE──► fetch → scan → recommend → done{probe_id, recommendation}
  │
  │  hard gate: Continue / Change model / (remote) API key modal
  ▼
POST /jobs/analyze {probe_id, model_id, api_key?}
  │
  ├── local:  ensure_model (download/load sidecar) → analyzer Chat Completions
  └── remote: analyzer → provider /v1 with Bearer key
  │
  ▼
store map → workspace
```

Ask Terra (v1): reuse the model chosen for the current workspace session.

## Module seams

### Catalog (`GET /models`)

Ship a static allowlist with Terra (Go or shared JSON loaded by Go).

**Local entry:** `id`, HF model id, display name, tier (`fast`|`balanced`|`quality`), `min_ram_gb`, preferred device, download size estimate, short “best for” blurb.

**Remote entry:** `id`, provider id, display name, `base_url`, provider `model` string, tier, `requires_api_key`, short “best for” blurb.

v1 remote providers: OpenAI plus a small set of OpenAI-compatible hosts (exact list at implementation; e.g. Groq / OpenRouter / Together).

### Host capabilities (`GET /host/capabilities`)

Returned from the Terra host process: `{ ram_gb, device, vram_gb? }` where `device` is `mps` | `cuda` | `cpu` (same notions as `TERRA_DEVICE` today).

Used to disable local models that cannot fit and to bias the recommender.

### Recommender (rule-based, hybrid)

1. **Provisional** — after cheap GitHub metadata (languages, approximate size).
2. **Refined** — after no-LLM scan (file count, language mix, monorepo / multi-package signals).
3. Score catalog candidates: task fit − host penalty − download cost; prefer local when quality is good enough for the estimated complexity.
4. Emit `{ model_id, reason, alternatives[] }`.

User can always override. Ineligible local models remain visible but disabled with a “needs ~X GB RAM” hint.

### Probe job (`POST /jobs/probe`)

Body: `{ repo_url }`.

SSE stages: `fetch` → `scan` → `recommend` → `done` (and `error`). An early event may carry a provisional recommendation; `done` includes:

```json
{
  "probe_id": "...",
  "repo": { "url": "...", "commit": "...", "languages": [] },
  "recommendation": {
    "model_id": "...",
    "reason": "...",
    "alternatives": ["...", "..."]
  }
}
```

Probe caches checkout/scan under `probe_id` with a short TTL for the following analyze.

### Analyze job (`POST /jobs/analyze`)

Extend today’s analyze enqueue:

```json
{
  "probe_id": "...",
  "repo_url": "...",
  "model_id": "...",
  "api_key": "..."
}
```

- Prefer `probe_id` to reuse scan; if expired, fall back to `repo_url` and rescan (UI may warn).
- `model_id` must be a catalog id.
- `api_key` required only for remote entries; omitted for local.
- SSE stages: `ensure_model` (local) → existing `analyze` / `store` / `done` (or `error`).

Go resolves `model_id` → base URL + provider model string, and passes per-request overrides into the analyzer. **Never log the API key. Never persist it to SQLite or `.env`.**

`graph.Analyze` already accepts a model string; extend the analyzer client/config path so base URL and Bearer token can be set per request (not only from process env).

### Local sidecar ensure

On local `model_id`:

1. If sidecar not running or wrong weights loaded, start/switch via the existing local server path (download HF weights if missing).
2. Stream coarse progress on `ensure_model` (download/load).
3. Preflight `/v1/models` then run analyze.

Cancel should abort the job and best-effort cancel download/load.

### Web workspace

1. URL paste starts **probe** (existing stage UI for fetch/scan).
2. On probe `done`, show **hard gate**: recommended model, one-line why, machine-fit note; primary **Continue with recommended**; secondary change-model list (local + remote).
3. Remote without a stored key → modal (provider label + key) → save to `localStorage` keyed by provider → then enqueue analyze.
4. During analyze, show `ensure_model` progress for local; header may show selected model (read-only while running).
5. Ask uses the session’s selected model/key the same way.

### Operator fallback

If the UI does not send `model_id`, keep current behavior: `TERRA_LLM_URL` / `TERRA_MODEL` / `TERRA_LLM_API_KEY` from the environment (Compose and `make run-analyzer`). Document that workspace picker overrides env for that job.

## Error handling

| Case | Behavior |
|---|---|
| Probe fail (bad URL, GitHub rate limit) | Error before gate; no analyze |
| Probe TTL expired | Analyze may rescan via `repo_url`; UI can note rescan |
| Local download fail / OOM | Analyze error with hint; suggest smaller local or remote |
| Remote 401/403 | UI clears stored key for provider; reopen key modal |
| Remote quota/billing | Surface provider message; keep model selection |
| Slow ensure_model | Progress events; cancel aborts job when possible |

## Testing focus

- Recommender unit tests: complexity × host tier → expected `model_id` / disabled locals.
- API: probe → analyze with `probe_id`; reject unknown `model_id`; remote without key → 400.
- Key never appears in logs, store fixtures, or probe cache payloads.
- UI: gate blocks analyze until Continue; remote opens key modal; local shows ensure progress.

## Later phase (not this spec)

Terra-managed paid plan: server-side provider keys, metering, no BYOK modal for billed models. Catalog and `model_id` stay stable; only auth/billing behind the router changes.

## Open implementation details (non-blocking)

- Exact HF model IDs and remote provider list (chosen when implementing catalog).
- Probe cache TTL and storage location (in-memory vs existing checkout volume).
- Whether `ensure_model` is implemented inside the Python local server or orchestrated by Go.
