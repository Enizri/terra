# Modules

Process-first monorepo: each deployable process owns its tree. Inside a process,
feature modules are deep (small interface, lots of behaviour).

## Dependency direction

```
backend/api/cmd/terra
  → backend/api/internal/server          (HTTP adapter)
      → backend/api/internal/analyze     (workflow)
      → backend/api/internal/store
      → backend/api/internal/analyzerclient
      → backend/api/internal/analysis
      → backend/api/internal/scan, preview, catalog, config, job, …

analyzer
  terra_analyzer.api → tasks → inference
  terra_local_llm    (separate process)

web
  app/routes → features → shared
```

Nothing below `backend/api/internal/server` may import it (depguard). Web `shared/` and
`features/` must not import `routes/` or `app/` (`boundaries.test.ts`).

## Why not cross-language vertical slices?

Go, Python, and Node each have their own packaging, tests, and deploy artifacts.
A single `features/analyze/{go,py,ts}` tree fights tooling and blurs who owns
the HTTP seam. Contracts at the repo root are the shared vocabulary instead.

## Why not a big layered rewrite?

We only introduce seams with a real second adapter (or a clear test need).
`analyzerclient` is the HTTP adapter; `analysis` is the map model; `store` is
SQLite. Speculative repository interfaces were rejected.
