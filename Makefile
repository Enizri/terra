.PHONY: run-analyzer run-server run-llm run-web build-web dev dev-api up down up-llm test test-fixtures test-go test-py lint fmt-go venv venv-local

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

VENV := analyzer/.venv
GOIMPORTS := $(shell go env GOPATH)/bin/goimports

venv:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q -e 'analyzer[dev]'

venv-local: venv
	$(VENV)/bin/pip install -q -e 'analyzer[dev,local]'

run-llm:
	cd analyzer && .venv/bin/uvicorn terra_analyzer.local_server.server:app --port 8020

run-analyzer:
	cd analyzer && TERRA_LLM_URL=$${TERRA_LLM_URL:-http://localhost:8020/v1} \
		.venv/bin/uvicorn terra_analyzer.app:app --port 8010

run-server:
	go run ./cmd/terra serve

run-web:
	cd web && npm install && npm run dev

dev:
	./scripts/dev.sh

dev-api:
	./scripts/dev.sh llm analyzer api

build-web:
	cd web && npm install && npm run build

up:
	docker compose up --build -d

up-llm:
	docker compose --profile llm up --build -d

down:
	docker compose down

test: test-fixtures test-go test-py

# web/src/data/memos.map.json is a hand-copy of the golden map with no
# regeneration path, so nothing but this stops the two drifting apart.
test-fixtures:
	diff -q case-studies/memos.map.json web/src/data/memos.map.json

lint:
	golangci-lint run

fmt-go:
	gofmt -w $$(find . -name '*.go' -not -path './analyzer/*')
	$(GOIMPORTS) -w $$(find . -name '*.go' -not -path './analyzer/*')

test-go:
	go build ./... && go test ./...

test-py:
	cd analyzer && .venv/bin/python -m pytest -q -m 'not slow'
