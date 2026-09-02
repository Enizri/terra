# Contributing

## Branching

GitHub’s default branch is **`main`**. Feature work still integrates on **`staging`**, then `staging` is promoted into `main`.

| Branch | Role |
|---|---|
| `main` | Default branch. Clone, repo homepage, and release. Do **not** open feature PRs against `main`. |
| `staging` | Integration. Branch from here; open PRs **into** `staging`. When ready, merge `staging` → `main`. |

```bash
git fetch origin
git checkout staging
git pull origin staging
git checkout -b issue/<n>-short-description   # or feat/…, fix/…
# … commit, push …
# Open a PR with base = staging (GitHub’s PR base defaults to main — change it)
```

Keep your branch rebased onto (or merged with) the latest `staging` before asking for review.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Go | 1.25+ | see `backend/api/go.mod` |
| Python | ≥3.11 (CI uses 3.12) | analyzer venv |
| Node | 22 | web |
| Docker | optional | Compose / preview |
| cmake + C++ compiler | for local LLM | `make venv-local` |

## First-time setup

```bash
cp .env.example .env          # set TERRA_TOKEN and LLM vars as needed
make venv-local               # once; compiles llama-cpp-python for local LLM
make dev                      # llm + analyzer + api + web
# or: make up                 # Compose (api + analyzer; hosted LLM via .env)
```

Before every PR: `make check`.

## Where does new feature code go?

See the table in [`ARCHITECTURE.md`](ARCHITECTURE.md). Domain terms:
[`CONTEXT.md`](CONTEXT.md).

## Recipes

### Change a wire field

Follow the checklist in [`packages/contracts/README.md`](../packages/contracts/README.md), then
`make check-contracts && make check`.

### Add a SQLite migration

1. Append a new entry to `migrations` in [`backend/api/internal/store/migrate.go`](../backend/api/internal/store/migrate.go).
2. Never edit a shipped version.
3. Add/extend a test under `backend/api/internal/store/` (prefer a legacy DB fixture for shape changes).
4. `(cd backend/api && go test ./internal/store/)`.

### Add an analyzer task

1. Create `backend/analyzer/terra_analyzer/tasks/<name>/` with typed input/output models.
2. Implement the `Task` protocol (`name` + `run`).
3. Register in `default_registry()` in `tasks/registry.py`.
4. Go reaches it via `analyzerclient.RunTask` / `POST /tasks/{name}` — no Go change for a generic task.
5. Keep task name stable once shipped. HTTP names today are `architecture` and `qa`.

### Add a role

1. Put system-prompt copy in `backend/analyzer/terra_analyzer/roles/<name>.py`.
2. Import it from the task that runs that role. Tasks keep the HTTP name; roles keep the prompt.
3. Do not inline a new system prompt inside `tasks/`.

### Add a tool

1. Put the JSON schema in `backend/analyzer/terra_analyzer/tools/`.
2. Put side effects in Go (HTTP). Python never `os/exec`s the preview checkout.
3. Allowlist the tool on the role that may call it.

### Add an eval

1. Add a golden file next to `case-studies/memos.map.json` when the check needs a fixture.
2. Put the pytest checker under `backend/analyzer/terra_analyzer/evals/` (no live LLM in CI).
3. Programmatic assertions first (paths, turn cap, tool allowlist). No LLM-as-judge in CI.

### Add a web feature module

1. Create `apps/web/src/features/<name>/` with a public `index.ts`.
2. Keep routes as composition only; put domain API/UI in the feature.
3. Import from `features/`, never from another route.
4. `npm test` (includes `boundaries.test.ts`).

### Update the golden map

1. Edit `case-studies/memos.map.json`.
2. `make sync-fixtures`.
3. Refresh `packages/contracts/fixtures/analysis-map.v1.json` if the map shape is the contract fixture source (script/`make check-contracts` expects them to match).

## PR expectations

1. Target **`staging`** (not `main`).
2. Run `make check`.
3. Keep the PR to **one concern**.
4. Reference the issue with `Fixes #N`.
5. Merge gate requires `check` + `actionlint` (see `.github/workflows/merge-gate.yml` and the PR template).

Commit messages in this repo are conventional-ish (`docs:`, `fix:`, `refactor(server):`). Match that style.
