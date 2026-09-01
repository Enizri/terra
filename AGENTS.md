# Agent instructions

This is the single source of agent instructions for Terra. Claude Code reads
[`CLAUDE.md`](./CLAUDE.md), which points here.

How to run the stack: [`README.md`](./README.md). Where code goes:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Domain terms:
[`docs/CONTEXT.md`](docs/CONTEXT.md). PR recipes:
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## Invariants

1. **Go and Python never import each other.** They talk over HTTP.
2. **The analyzer reaches a model only through OpenAI-compatible Chat Completions.**

Branch from **`staging`**. Open PRs into **`staging`**. Before a PR: `make check`.

## Where a change goes

| Change | Put it here |
|---|---|
| HTTP route / job streaming | `backend/api/internal/server/` (thin adapter) |
| Analyze pipeline | `backend/api/internal/analyze/` |
| Map types / assemble | `backend/api/internal/analysis/` |
| SQLite / migrations | `backend/api/internal/store/` |
| Scan / tarball | `backend/api/internal/scan/` |
| Analyzer task | `backend/analyzer/terra_analyzer/tasks/<name>/` |
| Local GGUF server | `backend/local-llm/terra_local_llm/` |
| Workspace UI | `apps/web/src/routes/workspace/` |
| Map diagram | `apps/web/src/features/architecture-map/` |
| Shared chrome | `apps/web/src/shared/` |

Go imports only point **down**. Nothing under `internal/` imports `server`.
Web imports: `routes → features → shared`. Golden map:
`case-studies/memos.map.json` (`make sync-fixtures`).

## Do not

- Commit `.env`, keys, GGUF weights, or `.claude/` / `.cursor/` local state.
- Mount `HeroDemo` on the landing until `apps/web/public/videos/landing/workspace-demo.mp4` exists.
- Rewrite git history or open feature PRs against `main`.
