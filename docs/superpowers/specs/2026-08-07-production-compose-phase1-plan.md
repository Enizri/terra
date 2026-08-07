# Phase 1a implementation plan

Follow `2026-08-07-production-compose-phase1-design.md`.

## Slices

1. **Analyzer LLM API key** — `inference/config.py` + `client.py` + test
2. **Store WAL** — `internal/store/store.go` + existing tests
3. **Server healthz + static + token** — `internal/server`, `cmd/terra`, tests
4. **Web token UX** — `shared/api.ts` + small unlock UI
5. **Preview Runner seam** — interface + host adapter wrapping current preview
6. **Compose packaging** — Dockerfiles, compose.yaml, Make, `.env.example`, README
7. **Validate** — `make test` + `docker compose up --build` health checks

Phase 1b (Docker preview runner) starts only after 1–7 are green.
