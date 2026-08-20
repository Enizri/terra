# ADR 0001: Process-first monorepo

## Status

Accepted

## Context

Terra spans a Go API, a Python analyzer, and a React web app. Contributors found
cross-cutting folders hard to navigate; we considered vertical slices that mix
languages in one feature directory.

## Decision

Keep one repository, three deployable processes, and organize *inside* each
process by feature/module. Share vocabulary via root `packages/contracts/` and
`CONTEXT.md`.

## Consequences

- Tooling stays native (Go modules, pip, npm).
- HTTP seams stay explicit.
- Contributors look up “which process?” first, then the module table in ARCHITECTURE.md.
