# Terra

Terra turns a GitHub repository into an interactive architecture map: the main
components, how they connect, and the source files behind them. Explore a project,
ask questions grounded in its code, and open its running software in a workspace.

## Status

Terra is pre-1.0 and built in the open. The current workspace flow is:

1. Paste or drop a GitHub repository URL.
2. Terra fetches repository metadata and scans its contents, then recommends a
   model. This probe makes no LLM call. A map already stored for the same commit
   can be reopened immediately.
3. Choose a local model or supply a key for a hosted model, then continue.
   Terra streams progress events and returns the completed architecture map.
4. Explore components and file evidence, ask the read-only guide questions, and
   start a live preview when the repository and available toolchains support it.

Saved analyses live in SQLite. The workspace lists recent analyses, can reopen or
delete them, and automatically opens the newest one when entering an empty
workspace. The URL slug is not a server-side session: chat, selections, and view
state are temporary. Model preferences and provider keys are stored in the browser.

| Page | Purpose |
|---|---|
| `/` | Marketing page with a scripted workspace demonstration and capability previews |
| `/about` | What Terra does and the planned team workflow, marked **Coming soon** |
| `/new` | Creates a workspace URL at `/new/s/:slug` |
| `/new/s/:slug` | Repository intake, model picker, architecture map, history, Ask, and preview |

The marketing demonstrations include illustrative interactions; they are not a
complete inventory of implemented workspace features.

| Current limitation | Details |
|---|---|
| Team collaboration | Shared team sessions and concurrent editing are planned, not shipped. There are no user accounts or per-user permissions. |
| Export and sharing | **Export JSON** and **Share map** in the workspace are disabled placeholders. The CLI and analysis API already return JSON. |
| Editing | The analyzer has a separate `editor` task with patch/restart tools. Workspace Ask uses the read-only `agent` task. There is no integrated Git commit, review, or merge workflow. |
| Preview support | Depends on the detected app and installed toolchains. The default Compose API image cannot run Go/Python previews through its host fallback. |
| Marketing links | Changelog, Privacy, and Terms in the footer are placeholders. About and GitHub are linked. |

Try the [Quickstart](#quickstart), or inspect
[`case-studies/memos.map.json`](case-studies/memos.map.json), the checked-in
architecture map for [usememos/memos](https://github.com/usememos/memos) used by
Terra's fixture checks.

Live preview installs dependencies and executes the analyzed repository's code.
The editor can modify its preview checkout, but does not commit changes. Read
[`docs/SECURITY.md`](docs/SECURITY.md) before running an unfamiliar repository or
exposing the stack outside a trusted environment.

## Architecture

```text
Browser / CLI / HTTP client
        |
        v
   Go API (:8080) ──────────────► SQLite (terra.db)
   repository scan, map assembly, jobs, storage, preview
        |
        | HTTP: /analyze or /tasks/{name}
        v
   Python analyzer (:8010)
   architecture, qa, agent, editor
        |
        | OpenAI-compatible POST /v1/chat/completions
        v
   Local GGUF server (:8020/v1), or a hosted compatible endpoint
   Local runtime: llama.cpp via llama-cpp-python
```

Go and Python never import each other. The analyzer reaches a model only through
OpenAI-compatible **Chat Completions**. The bundled local default is Qwen2.5 0.5B
Instruct Q4_K_M; the workspace catalog offers other local and hosted choices.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module ownership and import
rules, [`docs/CONTEXT.md`](docs/CONTEXT.md) for domain terms, and
[`packages/contracts/README.md`](packages/contracts/README.md) for versioned wire
schemas and compatibility rules.

## Quickstart

Run commands from the repository root unless shown otherwise.

| Prerequisite | Version / use |
|---|---|
| Go | 1.25+; the exact version is in `backend/api/go.mod` |
| Python | 3.11+ with venv support; CI uses 3.12 |
| Node.js | 22.18+ on the Node 22 line, as used by CI, with npm |
| CMake and a C++ compiler | Needed when installing the local `llama-cpp-python` runtime from source |
| Docker with Compose | Optional for the container stack and Docker previews |

### Local models

Create `.env` if you do not already have one:

```sh
[ -f .env ] || cp .env.example .env
```

Edit these values in `.env` for local inference. The example file currently points
at a hosted endpoint and enables offline Hugging Face access, so it needs these
changes before a first local run:

```dotenv
TERRA_LLM_URL=http://localhost:8020/v1
TERRA_MODEL=Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf
TERRA_LLM_API_KEY=
HF_HUB_OFFLINE=0
```

Then install the Python environment and start the stack:

```sh
make venv-local
make dev
```

`make dev` starts the local LLM on `8020`, analyzer on `8010`, Go API on `8080`,
and Vite on `5173`. It installs web dependencies if needed and opens
`http://localhost:5173/`. First local-model startup downloads and loads the GGUF
weights; allow time for that to finish. GPU offload requires a llama.cpp build
with the matching accelerator backend. The Compose LLM image uses CPU inference.

`make dev-api` starts the same stack without Vite. Stop either run with Ctrl-C.

### Hosted models without a local LLM

Set `.env` to your provider's OpenAI-compatible base URL, API key, and model ID.
For example, the repository's OpenAI catalog includes this configuration:

```dotenv
TERRA_LLM_URL=https://api.openai.com/v1
TERRA_LLM_API_KEY=your-provider-key
TERRA_MODEL=gpt-5.4-mini
```

```sh
make venv
./scripts/dev.sh analyzer api web
```

This starts only the analyzer, API, and web UI. The workspace picker uses its own
catalog choice and asks for the provider key in the browser; `.env` configures the
fallback for CLI and API requests that do not select a catalog model.

Both development commands load the root `.env`, which overrides existing shell
exports. Individual `make run-llm`, `make run-analyzer`, `make run-server`, and
`make run-web` targets do not load that file themselves; export the variables
first when running services separately.

### CLI and HTTP examples

With the analyzer and its model endpoint running:

```sh
(cd backend/api && go run ./cmd/terra scan https://github.com/usememos/memos)
(cd backend/api && go run ./cmd/terra map https://github.com/usememos/memos -o ../../memos.map.json)
```

`scan` reads a GitHub tarball without a local Git clone or model call. `map` also
calls the analyzer and stores its result in `terra.db` in the command's working
directory. Use `--db ''` to skip storage or `--db /path/to/terra.db` to choose it.

For HTTP, load the same token used by the API into the second terminal:

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

## Docker Compose playground

Go serves the built UI and API at `http://127.0.0.1:8080/`. Analyzer and optional
LLM ports are available only inside the Compose network.

Create `.env` as above, set a nonempty `TERRA_TOKEN` to your own shared secret,
and configure the hosted-model values from the previous section:

```sh
make up
curl -sf http://127.0.0.1:8080/healthz
docker compose logs --tail=20 analyzer
# When finished:
make down
```

`make up` builds and starts API + analyzer. For local GGUF inference, set
`TERRA_LLM_URL=http://llm:8020/v1`, restore the local GGUF `TERRA_MODEL`, clear
`TERRA_LLM_API_KEY`, set `HF_HUB_OFFLINE=0` for downloads, and run `make up-llm`.

The `terra-data` volume holds `/data/terra.db` and `/data/checkouts`; the
`terra-hf-cache` volume holds local model weights. `make down` preserves these
volumes. The API image serves the web bundle from `/app/apps/web/dist`.

`TERRA_TOKEN` is required because the API binds `0.0.0.0` inside its container.
When serving the UI, Go sets an HttpOnly cookie so the browser does not need a
manual token entry. Local `make dev` forwards the token through Vite's proxy.
This shared token is not user authentication: anyone served the UI receives the
cookie. See [`docs/SECURITY.md`](docs/SECURITY.md).

| Symptom | Check |
|---|---|
| `llm UNREACHABLE` | Endpoint URL, provider key, and whether the model server is ready |
| `serving X, not Y` | `TERRA_MODEL` must identify a model served by that endpoint |
| URL points at `localhost` inside Compose | Use a hosted URL or `http://llm:8020/v1`; container localhost is not the host machine |
| Local weights cannot download | Check network access and `HF_HUB_OFFLINE`; offline mode needs already-cached weights |
| GitHub requests are rate-limited | Set `GITHUB_TOKEN` for authenticated repository requests |

The analyzer's `/healthz` can return HTTP 200 with `llm_ok: false`. A healthy
container alone does not confirm that inference works; inspect that field and the
analyzer's startup logs.

### Live preview

Preview detects runnable apps and boots supported web/API apps, plus mobile or
desktop apps with a supported preview path. Libraries and CLIs have dedicated
stages for repository information, tests, or CLI output. These operations depend
on the tools installed where the runner executes.

In host mode, repository processes run directly on the API host. In Docker mode,
supported Node apps run in sibling containers using `TERRA_PREVIEW_IMAGE`.
Go/Python and other host-only launch paths run in the API process's environment;
in the supplied Compose API image, the Go/Python toolchains are absent, so those
previews cannot boot. Docker mode is not a universal container runner.

Compose mounts the Docker socket and shares checkouts through `terra-data`.
Frameworks with configurable base paths (Vite, Angular, CRA) can use the same-origin
`/__live/{id}/` proxy. Other Node frameworks use their own loopback origin.
`TERRA_PREVIEW_MAX` limits concurrent **apps**, not repositories (default `2`);
`TERRA_PREVIEW_TTL` controls idle shutdown (default `30m`).

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
  [`backend/api/internal/catalog/catalog.go`](backend/api/internal/catalog/catalog.go).
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

## Commands and API

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

Go API routes are registered in
[`backend/api/internal/server/server.go`](backend/api/internal/server/server.go):

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

The analyzer on `8010` exposes `GET /healthz`, `GET /tasks`, `POST /analyze`
(the Go-to-Python contract), and `POST /tasks/{name}`. Registered tasks are
`architecture`, `qa`, `agent`, and `editor`. Requests accept model routing fields
`model`, `base_url`, and `api_key`. Agent/editor responses stream NDJSON progress
and a final answer. The editor can call Go's patch/restart endpoints; it is not
exposed through the workspace's read-only `/jobs/agent` route.

The local sidecar on `8020` exposes `GET /healthz`, `GET /v1/models`,
`POST /v1/chat/completions`, `GET /admin/status`, `POST /admin/load`, and
`POST /admin/cancel`.
Status reports `ready`, `loading`, `error`, or `empty`. Loading returns immediately;
requesting the same model reuses its load, while choosing another supersedes the
previous request. Cancellation prevents an abandoned result from being installed,
although its download may still finish.

## Environment variables

Defaults below describe code defaults. `.env`, Compose, and CLI flags can change
them. Never commit real keys or a populated `.env`.

| Variable | Read by | Default / purpose |
|---|---|---|
| `TERRA_ANALYZER_URL` | Go | `http://localhost:8010`; Compose uses `http://analyzer:8010` |
| `TERRA_API_URL` | Analyzer tools | `http://127.0.0.1:8080`; Compose uses `http://api:8080` for file/patch/restart calls |
| `TERRA_LLM_URL` | Analyzer | `http://localhost:8020/v1`; OpenAI-compatible base URL |
| `TERRA_LLM_API_KEY` | Analyzer | Empty; optional operator provider key |
| `TERRA_MODEL` | Analyzer / local LLM | `Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf`; provider model ID for hosted inference |
| `TERRA_LLM_TIMEOUT` | Analyzer | `600` seconds per model read timeout |
| `TERRA_ANALYZE_TIMEOUT` | Go | `15m` job timeout |
| `TERRA_ANALYZE_CONCURRENCY` | Go | `4` concurrent analyze jobs; excess requests receive 429 |
| `TERRA_RATE_LIMIT` | Go | `2` requests/second per IP on rate-limited routes; `0` disables |
| `TERRA_REQUIRE_MODEL` | Go | `false`; require an explicit catalog model for analysis/Ask |
| `TERRA_TOKEN` | Go / analyzer / Vite | Empty; shared API secret, required for a non-loopback API bind |
| `TERRA_LOCAL_LLM_URL` | Go | `http://localhost:8020`; sidecar for loading selected local models; Compose uses `http://llm:8020` |
| `TERRA_DEVICE` | Local LLM / Go host detection | `auto` (`mps`, `cuda`, or `cpu`); supplied Compose services pin `cpu` |
| `TERRA_N_CTX` | Local LLM | `18432` token context window |
| `TERRA_N_THREADS` | Local LLM | Half the logical CPU count, minimum 1; `0` also selects this default |
| `TERRA_N_GPU_LAYERS` | Local LLM | All layers on an accelerator, with fallback to 16 then CPU; explicit values disable fallback |
| `HF_HUB_OFFLINE` | Hugging Face client | Set `0` to allow downloads; `1` requires cached weights. `.env.example` currently sets `1` |
| `HF_HOME` | Hugging Face client | Model/cache location; Compose mounts the weight cache at `/hf` |
| `TERRA_PREVIEW_MODE` | Go | Empty means host execution; Compose sets `docker` |
| `TERRA_PREVIEW_MAX` | Go | `2` concurrent preview apps; `0` refuses preview before checkout |
| `TERRA_PREVIEW_TTL` | Go | `30m` idle TTL; nonpositive durations disable expiry |
| `TERRA_PREVIEW_IMAGE` | Go | `node:22-bookworm` for Docker preview apps |
| `TERRA_PREVIEW_NETWORK` | Go | Empty; Compose sets `terra-net` for sibling containers |
| `TERRA_DOCKER` | Go | `docker`; override the executable path |
| `TERRA_CHECKOUT_DIR` | Go | User cache directory; Compose sets `/data/checkouts` |
| `TERRA_CHECKOUT_VOLUME` | Go | Empty; Compose sets `terra-data` for sibling checkout mounts |
| `TERRA_HOST_CHECKOUT_DIR` | Go | Empty; optional host path remapping for bind-mounted checkouts |
| `TERRA_PUBLIC_URL` | Go | Defaults to loopback with the API's listen port; Compose sets `http://127.0.0.1:8080` |
| `TERRA_TRACE_HOST` | Go | Trace callback host for preview apps; Compose sets `host.docker.internal` |
| `TERRA_WEB_URL` | Go / dev launcher | Empty in Go; `make dev` uses `http://localhost:5173/` for opening the UI and redirecting API `/` |
| `TERRA_API` | Vite config | `http://localhost:8080`; development API proxy target |
| `VITE_TERRA_DEMO` | Web build | Empty; `1` enables the bundled-map demo mode below |
| `GITHUB_TOKEN` | Go repository fetch | Empty; optional token for authenticated GitHub requests |

Set the API listen address with `terra serve --addr`; the CLI currently overrides
`TERRA_ADDR`. Set the SQLite path with `--db` (default `terra.db`).

## Public demo build

A public demo can show architecture maps with repository execution disabled. Use
these settings in the server environment, supplying your own token:

```dotenv
TERRA_PREVIEW_MAX=0
TERRA_LLM_API_KEY=
TERRA_REQUIRE_MODEL=1
TERRA_TOKEN=replace-with-your-own-shared-secret
TERRA_RATE_LIMIT=0.2
```

Build the UI with:

```sh
VITE_TERRA_DEMO=1 npm --prefix apps/web run build
```

Serve that bundle with Go's `--static` option. This flag applies to the web build;
the supplied Compose Dockerfile builds its own bundle and does not forward this
build flag automatically.

`TERRA_PREVIEW_MAX=0` refuses preview boot before checkout. Preview test/CLI jobs
require an already-mounted preview and return 409 when none exists.
`TERRA_REQUIRE_MODEL=1` removes the operator-model
fallback from the Go analysis/Ask routes. Remote catalog models require the
caller's provider key. Local catalog entries remain available when a sidecar is
reachable and the host passes eligibility checks; this flag is not a remote-only
allowlist.

Demo mode fills an empty workspace with the bundled memos map and shows a preview
limitation notice. Its map can be explored without a key; new model-generated
answers still need an available model and any required provider key. Dropping a
repository starts the normal probe/model flow. `?nofixture` suppresses the bundled
map; in development, `?fixture` opts into it.

This is still a shared, pre-1.0 deployment with no user accounts. Review
[`docs/SECURITY.md`](docs/SECURITY.md) before publishing it.

## Tests and promotion

```sh
make venv              # first-time test setup; no GGUF runtime required
# Install the Go linter version used by CI if it is not already available:
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2
make check
make build-web         # production TypeScript/Vite build, separate from make check
```

`make check` runs contract/fixture validation, Go build/tests, Python unit tests and
harness evals, web logic/component tests, and lint. Python tests marked `slow` are
excluded. Contract schema validation uses `jsonschema` when available to the
`python3` running the script; otherwise it runs structural checks plus the
language-native fixture tests.

| Suite | Location / command |
|---|---|
| Go | `backend/api/internal/`; `make test-go` |
| Analyzer and local LLM | `backend/analyzer/tests/`, `backend/local-llm/tests/`; `make test-py` |
| Harness evals | `backend/analyzer/terra_analyzer/evals/`; `make eval` |
| Web logic and components | `apps/web/src/**/*.test.ts` (Node) and `*.test.tsx` (Vitest); `make test-web` |
| Versioned contracts | `packages/contracts/`; `make check-contracts` |
| Golden fixture sync | `case-studies/memos.map.json` → `apps/web/src/data/`; `make test-fixtures` |
| Live GitHub + LLM | `TERRA_INTEGRATION=1 make test-integration`; needs network and a running model endpoint |
| Compose end-to-end | `TERRA_SMOKE=1 make smoke`; needs Docker, a configured provider, and its key |

The live suites fetch repositories and can spend model tokens. The Compose smoke
suite checks provider connectivity, authentication, the probe gate, analysis,
stored-map persistence across API restart, Ask, preview, patch/restart, and rate
limits. It also checks the known Go-preview limitation. See the `TERRA_SMOKE_*`
options in `.env.example`; it tears down Compose afterward unless
`TERRA_SMOKE_KEEP=1` is set, and preserves data volumes.

A passing default check does not validate the assembled deployment, preview
isolation, or multi-user behavior. Harness evals use programmatic assertions and
recorded trajectories, not an LLM judge.

GitHub's default branch is **`main`**. Branch from **`staging`**, open feature PRs
into **`staging`**, and promote **`staging` → `main`** after verification. Before a
PR, run `make check`; the merge gate also requires the `actionlint` workflow to
pass for the PR's current commit. See
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE). Bundled third-party assets retain their own
licenses. The celestial globe model is CC0; its provenance is recorded in
[`celestial-globe-license.txt`](apps/web/public/terra/models/celestial-globe-license.txt).
