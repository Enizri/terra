.PHONY: run-analyzer run-server run-llm run-web build-web dev dev-api up down up-llm \
	test test-fixtures sync-fixtures test-go test-py test-web test-integration eval smoke \
	lint lint-go lint-web lint-py check check-contracts fmt-go venv venv-local

# One-command local stack (host processes, hot reload):
#   make venv-local   # once
#   make dev          # llm + analyzer + api + web
#   make dev-api      # same without web
# Individual targets (run-llm, run-analyzer, …) still work for single-service work.
#
# Production-shaped playground (Docker Compose):
#   cp .env.example .env   # set TERRA_TOKEN + LLM vars
#   make up                # api + analyzer (hosted LLM via .env)
#   make up-llm            # same + local HF llm profile
#   make down
#
# Verification:
#   make check            # fixtures + Go/Python/web tests + lint
#   make test             # fixtures + Go/Python/web tests (no lint)
#   make eval             # programmatic harness evals (no live LLM)
#   make test-integration # opt-in live GitHub + live LLM (needs env + services)
#   make smoke            # opt-in end-to-end run against the Compose stack

VENV := backend/.venv
GOIMPORTS := $(shell go env GOPATH)/bin/goimports

venv:
	python3 -m venv $(VENV)
	$(VENV)/bin/python -m pip install -q -e 'backend/analyzer[dev]' -e 'backend/local-llm[dev]'

venv-local: venv
	$(VENV)/bin/python -m pip install -q -e 'backend/local-llm[local]'

run-llm:
	cd backend/local-llm && HF_XET_HIGH_PERFORMANCE=1 ../.venv/bin/python -m uvicorn terra_local_llm.server:app --port 8020

run-analyzer:
	cd backend/analyzer && TERRA_LLM_URL=$${TERRA_LLM_URL:-http://localhost:8020/v1} \
		../.venv/bin/python -m uvicorn terra_analyzer.app:app --port 8010

run-server:
	cd backend/api && go run ./cmd/terra serve

run-web:
	cd apps/web && npm install && npm run dev

dev:
	./scripts/dev.sh

dev-api:
	./scripts/dev.sh llm analyzer api

build-web:
	cd apps/web && npm install && npm run build

up:
	docker compose up --build -d

up-llm:
	docker compose --profile llm up --build -d

down:
	docker compose down

# Fast suite: fixtures + every language's default tests.
test: test-fixtures test-go test-py test-web

# Full gate used by CI and local "am I green?" runs.
check: check-contracts test lint

# Canonical golden: case-studies/memos.map.json.
# Web ships a copy under apps/web/src/data/ for the Vite bundle.
sync-fixtures:
	./scripts/sync-fixtures.sh

test-fixtures:
	./scripts/sync-fixtures.sh --check

lint: lint-go lint-web lint-py

lint-py:
	cd backend/analyzer && ../.venv/bin/python -m compileall -q terra_analyzer tests
	cd backend/local-llm && ../.venv/bin/python -m compileall -q terra_local_llm tests
	@# Prefer ruff when installed in the venv; otherwise compileall is the floor.
	@if backend/.venv/bin/python -m ruff --version >/dev/null 2>&1; then backend/.venv/bin/python -m ruff check backend/analyzer backend/local-llm; 	elif command -v ruff >/dev/null 2>&1; then ruff check backend/analyzer backend/local-llm; 	else echo "lint-py: ruff not installed; compileall only"; fi

check-contracts:
	./scripts/check-contracts.sh

lint-go:
	mkdir -p .cache/golangci
	cd backend/api && GOLANGCI_LINT_CACHE="$(CURDIR)/.cache/golangci" PATH="$(shell go env GOPATH)/bin:$$PATH" golangci-lint run --config ../../.golangci.yaml

lint-web:
	cd apps/web && npm install && npm run lint

fmt-go:
	gofmt -w $$(find backend/api -name '*.go')
	$(GOIMPORTS) -w $$(find backend/api -name '*.go')

test-go:
	cd backend/api && go build ./... && go test ./...

# CI (`make check` → test-py) deselects @pytest.mark.slow so live llama.cpp
# never runs in GitHub Actions. Harness evals under terra_analyzer/evals/ are
# included here too (programmatic checkers; no LLM-as-judge).
test-py:
	cd backend/analyzer && ../.venv/bin/python -m pytest -q -m 'not slow'
	cd backend/local-llm && ../.venv/bin/python -m pytest -q

# Ask goldens + recorded trajectories + policy (paths, turn cap, allowlist).
# Same -m 'not slow' as test-py; live llama.cpp stays opt-in via TERRA_SLOW=1.
eval:
	cd backend/analyzer && ../.venv/bin/python -m pytest -q -m 'not slow' terra_analyzer/evals

test-web:
	cd apps/web && npm install && npm test

# Opt-in live suites. Accepts TERRA_INTEGRATION=1, or the legacy
# TERRA_LIVE / TERRA_SLOW knobs (see README).
test-integration:
	./scripts/test-integration.sh

# Full loop against the production-shaped Compose stack: boot, auth gate, probe
# gate, analyze, restart persistence, ask, docker-mode preview, editor writes,
# rate limit. Opt-in: it builds images, fetches repos, and spends tokens.
smoke:
	./scripts/smoke.sh
