---
name: Bug report
about: Something behaves differently than documented
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- Observed behavior. Exact error text if it's short. -->

## What you expected

## Repro

1.
2.
3.

## Which part

- [ ] Go API / CLI (`backend/api`)
- [ ] Python analyzer (`backend/analyzer`)
- [ ] Local LLM sidecar (`backend/local-llm`)
- [ ] Web (`apps/web`)
- [ ] Build / Compose / CI

## Environment

- How you ran it: `make dev` / `make up` / `make up-llm` / CLI
- Model: local GGUF or hosted (`TERRA_MODEL`, and the provider if hosted)
- OS and arch:
- Repository you were mapping, if it's public:

## Logs

<!-- `docker compose logs analyzer` for Compose, or the failing service's output.
     Please redact tokens and API keys. -->
