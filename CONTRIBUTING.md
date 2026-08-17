# Contributing

## Where does new feature code go?

Pick the process that owns the behavior, then put the code where that process
already keeps similar work. Folder maps and import rules live in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

| Kind of change | Put it here |
|---|---|
| HTTP API / jobs / storage / preview / scan | Go under `internal/` — handlers split by feature in `internal/server/` (`analyze.go`, `ask.go`, …; `Handler` stays in `server.go`); shared capabilities as sibling packages (`internal/scan`, `internal/store`, …); CLI entry in `cmd/terra` |
| Agent task / schema / validate / prompts | Python under `analyzer/terra_analyzer/` — one task per `agents/<name>.py` (or a package like `agents/architecture/` when schema/prompt/validate belong with the task); register in `agents/registry.py` |
| UI / workspace / landing | Web under `web/src/` — routes in `routes/<name>/`, shared pieces in `shared/`, one route line in `app/App.tsx` |

Go and Python never import each other (HTTP only). Web talks to the Go API.

## Before you open a PR

1. Run `make check` (fixtures + Go/Python/web tests + lint).
2. Keep the PR to **one concern** — one issue, one coherent change.
3. Reference the issue in the description with `Fixes #N`.
