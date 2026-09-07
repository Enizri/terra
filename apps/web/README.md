# Terra web

React 19 + Vite SPA for Terra. Root docs: [`../../README.md`](../../README.md) (run)
and [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) (change).

## Layout

```
src/
  app/        router + entry
  routes/     landing/, about/, workspace/
  features/   analysis, architecture-map, ask, preview
  shared/     site/, shell/, styles/, HTTP helpers — no route or feature imports
  data/       fixtures synced from ../../case-studies/
```

Import direction (enforced by `src/boundaries.test.ts`):

- `routes/*` → `features/*`, `shared/*`, `data/*`
- `features/*` must not import `routes/` or `app/`
- `shared/*` must not import `features/`, `routes/`, or `app/`
- routes must not import each other

`shared/shell/` is workspace chrome reused by both the landing hero and the
product workspace. CSS class names stay `.sh-ws__*`.

`shared/site/` owns the Terra mark and navigation shared by the landing and About
pages. `/` is the marketing page; `/about` describes the product and upcoming team
workflow. `/new` redirects to `/new/s/:slug`, the workspace. Its slug does not
identify a persisted server session; saved maps reopen through analysis history.
The browser icon is `public/favicon.svg`.

## Dev

From the repo root, prefer `make dev` (starts LLM + analyzer + API + this app).

For hosted inference without the local LLM, use
`./scripts/dev.sh analyzer api web` from the repo root after `make venv` and provider
configuration. See the root README for `.env` setup.

For the web UI alone, run these commands from `apps/web` (Node 22.18+ on Node 22):

```sh
npm install
npm run dev          # Vite on :5173, proxies API to TERRA_API (default :8080)
```

Standalone Vite reads `TERRA_API` and `TERRA_TOKEN` from its process environment;
export them first if the API uses a different address or requires a token. The
root dev launcher loads `.env` and supplies these automatically.

`npm run build` type-checks and writes `dist/`. `make build-web` from the repo root
runs the same build after installing dependencies. Serve the result through Go's
`--static` flag, for example from the repo root:

```sh
go -C backend/api run ./cmd/terra serve --static ../../apps/web/dist
```

For a demo bundle, build with `VITE_TERRA_DEMO=1`; it seeds an empty workspace with
the memos fixture. `?nofixture` disables this seed. During development, `?fixture`
opts into it. This build flag does not disable backend preview execution; configure
the API separately as described in the root README.

## Tests

```sh
npm test             # node --test over *.test.ts, then vitest over *.test.tsx
npm run lint         # oxlint
```

Root `make test` / `make check` already include these. Pure logic uses
`node --test` (no DOM); component tests use vitest + jsdom and end in `.test.tsx`.

No path aliases — relative imports with explicit extensions so `node --test`
resolves them.

## Fixtures

`src/data/memos.map.json` is a copy of `../../case-studies/memos.map.json`. After
editing the golden map:

```sh
make sync-fixtures   # from repo root
```
