.PHONY: run-analyzer run-server run-llm run-web build-web test test-go test-py lint fmt-go venv venv-local

# Three-terminal quickstart:
#   terminal 1: make run-llm         (loads HF model behind OpenAI-compatible /v1)
#   terminal 2: make run-analyzer
#   terminal 3: make run-server      (or: go run ./cmd/terra map <github-url>)

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

build-web:
	cd web && npm install && npm run build

test: test-go test-py

lint:
	golangci-lint run

fmt-go:
	gofmt -w $$(find . -name '*.go' -not -path './analyzer/*')
	$(GOIMPORTS) -w $$(find . -name '*.go' -not -path './analyzer/*')

test-go:
	go build ./... && go test ./...

test-py:
	cd analyzer && .venv/bin/python -m pytest -q -m 'not slow'
