# Terra architecture

How the pieces fit, which direction imports are allowed to point, and where new
code goes. `README.md` covers running it; this file covers changing it.

## The three processes

```
User (CLI / browser)
        |
        v
   Go backend (:8080)  ──────────────► SQLite (terra.db)
   tarball ingest, scan, HTTP API, storage
        |
        | POST /analyze  {scan, model}
        v
   Python analyzer (FastAPI, :8010)
   agent tasks (architecture, qa), validate, retry
        |
        | OpenAI-compatible POST /v1/chat/completions
        v
   Local HF server (:8020/v1) — or any OpenAI-compatible endpoint
```

Two invariants hold everywhere and are worth keeping:

1. **Go and Python never import each other.** They talk over HTTP. Either side
   can be restarted, replaced or run on another host.
2. **The analyzer reaches a model only through the OpenAI-compatible Chat
   Completions API,** so a laptop HF server, vLLM or a hosted provider are
   drop-in replacements.

## Go — `github.com/Enizri/terra`

One module, one binary today, layered so that imports only ever point **down**
this list:

| Package | Does | Imports |
|---|---|---|
| `cmd/terra` | CLI: `scan`, `map`, `serve` | all of the below |
| `internal/server` | HTTP API — jobs, analyses, preview, ask, files, models | graph, preview, store, job, catalog, recommend, llmlocal, config, … |
| `internal/store` | SQLite persistence keyed by repo URL | graph, scan |
| `internal/preview` | Clone a repo, boot its dev server, reverse-proxy it with `select.js` injected | scan, runfile, trace |
| `internal/graph` | Wire types + the HTTP client to the analyzer | scan |
| `internal/catalog` | Static model allowlist + host capability helpers | nothing domain-specific |
| `internal/config` | Parses every `TERRA_*` env var once at startup | nothing |
| `internal/scan` | Tarball ingest (SHA-keyed, no git), languages, dependency manifests | nothing |

Rules:

- **No `internal` package imports `server`** — only `cmd/*` does. It is the top
  of the stack. Enforced by `.golangci.yaml` depguard.
- **`internal/scan` stays dependency-free.** It is the leaf every other package
  is allowed to build on.
- Product-specific behavior belongs at the top (`cmd/`, `internal/server`);
  generic behavior belongs in the leaves.

## Python — `analyzer/`

```
terra_analyzer/
  app.py              FastAPI app (:8010) — /healthz /tasks /tasks/{name} /analyze
  agents/             one file per task; base.py is a 3-line Task protocol,
                      registry.py maps name -> task
  prompts/            system prompts and prompt building
  schema.py           enums + the model's JSON schema — single source of truth
  models.py           Pydantic mirrors of the Go wire types
  validate.py         normalize / repair / build a retry message
  inference/          the OpenAI-compatible client and its config
  local_server/       an optional GGUF-backed /v1 server (:8020)
```

`local_server` is behind the optional `[local]` extra and nothing else in the
package imports it — it is a separate process, not a dependency.

Do **not** relocate `analyzer/` casually: `analyzer/tests/test_app.py` resolves
`../../case-studies` by relative path. The golden test now **fails hard** if that
fixture is missing (it used to `skipif`, which hid broken layouts).

## Web — `web/src`

```
app/          router + entry. Knows every route, owns no UI.
routes/
  landing/    the marketing page: TerraLanding.tsx composes sections/*,
              primitives.tsx holds what several sections share, data.ts holds
              copy and fixtures, theater.tsx holds the demo replicas
  workspace/  /new/s/:slug — the real product surface. Workspace.tsx owns the
              shared state (the run, the selection, this tab's history) and
              nothing else; sections/* are the four panes, selection.ts is the
              pick maths, slug.ts is imported by the router alone so minting a
              session id never pulls the route in
shared/       api.ts, live.tsx, motion.ts, map/, shell/, markdown, fileTree,
              ndjson, styles/{tokens,ui,global}.css
  shell/      workspace chrome reused by landing hero + product workspace
              (CSS classes stay `.sh-ws__*`; folder name is shell because both
              routes own it)
  map/        wire types, diagramViews (view-model), RepoDiagram renderer,
              toDiagram layout
data/         committed fixtures (synced from case-studies/)
```

Rules:

- **`routes/*` may import `shared/*`.**
- **`shared/*` must never import a route.** If shared code needs a value a page
  owns (a repo URL, a fixture), it takes it as a prop or an argument.
- **Routes must not import each other.** Anything two routes need moves to
  `shared/`.
- CSS follows the same shape: `shared/styles/tokens.css` (the `.sh-root` shell
  and custom properties, loaded by every route), `shared/styles/ui.css`
  (components more than one route renders), then the route's own stylesheet.
  A route sheet must not rely on load order to win: every selector in it that
  also appears in another sheet is scoped under a route-only ancestor class
  (`.sh-section--hero`, `.sh-ws__dock`, …), so the sheets stay order-independent
  and a route can be lazy-loaded without restyling the other. Styling for
  shared components' own behavior (e.g. `RepoDiagram`'s `is-focus`/`is-dim`
  states) lives in `ui.css`, never in a route sheet.
  `shared/styles/global.css` sits below all of that — `app/main.tsx` loads it first for the document reset and the warm
  editorial `:root` tokens (`--ink`, `--ivory`, `--yellow`, the display font)
  that `landing.css` still reads.
- No path aliases. `npm test` runs `node --test` directly over `.ts` files with
  explicit extensions, and it does not resolve tsconfig `paths`.
- Import rules are enforced by `web/src/boundaries.test.ts`.

## Fixtures and contracts

- **Canonical golden map:** `case-studies/memos.map.json`.
- **Web bundle copy:** `web/src/data/memos.map.json`, produced by
  `make sync-fixtures` (`scripts/sync-fixtures.sh`). `make test-fixtures`
  fails if they differ.
- **Scan micro-fixtures** for Go unit tests live under `internal/scan/testdata/`
  and are independent of the memos case study.
- Do not commit `*.generated.json` under `case-studies/` — those are scratch
  LLM outputs, not golden inputs.

## Verification

| Command | What it runs |
|---|---|
| `make test` | fixtures + Go + Python (not slow) + web |
| `make lint` | golangci-lint + `web` oxlint |
| `make check` | `test` + `lint` (CI entry point) |
| `make test-integration` | live GitHub + live LLM when `TERRA_INTEGRATION=1` |

Tests stay language-native: Go `*_test.go` colocated, Python under
`analyzer/tests/`, web `*.test.ts(x)` colocated. Do not invent a root `tests/`
tree for unit tests.

Web dual runners (intentional): pure-logic `*.test.ts` on `node --test`;
DOM `*.test.tsx` on vitest/jsdom.

## Adding a new product

Nothing outside these three additions should need to change:

1. **Backend** — `cmd/<name>/main.go`, reusing `internal/*`. Keep the layering
   rule; add a new `internal/<capability>` package only if the capability is
   genuinely new, and give it the smallest dependency set that works.
2. **Frontend** — `web/src/routes/<name>/`, plus one route line in
   `app/App.tsx`. Import from `shared/` only.
3. **AI capability** — `analyzer/terra_analyzer/agents/<name>.py` implementing
   the `Task` protocol, plus one line in `default_registry()`. Go reaches it
   generically through `graph.RunTask(name, payload)`; no Go change needed.

## Known warts

Named on purpose. None of them is load-bearing for a second product, and each
is cheaper to fix when there is a real second case than to generalize now.

- **Preview boot uses Go `internal/runfile`, not the Python agent.** Production
  preview/dev-server boot is owned by `internal/runfile`. The analyzer's
  `agents/runfile.py` (`RunfileWriter`) is parked/experimental and is not in
  `default_registry()` until someone wires `RunTask("runfile")` as a fallback.
- **`internal/preview` carries demo-specific code.** Cookie prefix, auth
  endpoints, seed content and the Go-backend heuristic are all tuned to
  `usememos/memos` (~90 lines). A second demo repo is what should force the
  seam, and the seam is a small interface, not a rewrite.
- **The Go↔Python wire contract is mirrored by hand** in four places
  (`internal/scan.Result` ↔ `models.py::ScanResult`, `internal/graph/types.go`
  ↔ `models.py::Draft`). The enums live only in `schema.py`. There is no
  codegen; `internal/graph`'s contract test against `case-studies/memos.map.json`
  is what catches drift.
- **`internal/store` is typed to `graph.Map`,** so it is Terra's schema rather
  than a generic store. Maps live only in `projects.map_json` (no normalized
  component/relationship tables). It has **no migrations** — the schema is
  re-created on open and the documented fix for a shape change is deleting
  `terra.db`.
- **No shared logging or error-type layer in Go.** `internal/config` centralizes
  `TERRA_*` parsing; errors remain `fmt.Errorf` strings. Fine at this size;
  revisit when a second binary needs the same wiring.
