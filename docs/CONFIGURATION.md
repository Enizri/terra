# Configuration

Every environment variable Terra reads, plus the settings for a locked-down
public demo deployment. For a first run you only need the handful listed in the
[README quickstart](../README.md#the-environment-variables-you-actually-need).

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

Both `make dev` and `make dev-api` load the root `.env`, which overrides existing
shell exports. Individual `make run-llm`, `make run-analyzer`, `make run-server`,
and `make run-web` targets do not load that file themselves; export the variables
first when running services separately.

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
`TERRA_REQUIRE_MODEL=1` removes the operator-model fallback from the Go
analysis/Ask routes. Remote catalog models require the caller's provider key.
Local catalog entries remain available when a sidecar is reachable and the host
passes eligibility checks; this flag is not a remote-only allowlist.

Demo mode fills an empty workspace with the bundled memos map and shows a preview
limitation notice. Its map can be explored without a key; new model-generated
answers still need an available model and any required provider key. Dropping a
repository starts the normal probe/model flow. `?nofixture` suppresses the bundled
map; in development, `?fixture` opts into it.

This is still a shared, pre-1.0 deployment with no user accounts. Review
[`SECURITY.md`](SECURITY.md) before publishing it.
