# Terra web

React 19 + Vite SPA for Terra. Root docs: [`../../README.md`](../../README.md) (run)
and [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) (change).

## Layout

```
src/
  app/        router + entry
  routes/     landing/ (marketing) and workspace/ (product)
  shared/     api, map/, shell/, styles/ — never imports a route
  data/       fixtures synced from ../../case-studies/
```

Import direction (enforced by `src/boundaries.test.ts`):

- `routes/*` → `shared/*`, `data/*`
- `shared/*` must not import `routes/` or `app/`
- routes must not import each other

`shared/shell/` is workspace chrome reused by both the landing hero and the
product workspace. CSS class names stay `.sh-ws__*`.

## Dev

From the repo root, prefer `make dev` (starts LLM + analyzer + API + this app).

Alone:

```sh
npm install
npm run dev          # Vite on :5173, proxies API to TERRA_API (default :8080)
```

Production build is served by Go (`terra serve --static apps/web/dist`); `make build-web`
from the repo root.

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

## Asset bake (optional)

`scripts/render_ask_terra.py` bakes the landing ask-terra video from a Screen
Studio project. Paths are CLI args — see `python scripts/render_ask_terra.py -h`.
