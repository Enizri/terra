# Terra

Turns a GitHub repository into an architecture map a non-engineer can read:
components, relationships, and the evidence for them.

## Architecture

```
User (CLI / HTTP)
        |
        v
   Go backend  ──────────────► SQLite (terra.db)
   clone, scan, API, storage
        |
        | POST /analyze  {scan, model}
        v
   Python analyzer (FastAPI, :8010)
   agent tasks (architecture, …), validate, retry
        |
        | OpenAI-compatible POST /v1/chat/completions
        v
   Local HF server (:8020/v1)   — or any OpenAI-compatible endpoint
   Transformers + torch
        |
        v
   Qwen/Qwen2.5-0.5B-Instruct (HF cache)
```

Go and Python never import each other — they talk over HTTP. The analyzer
talks to the model only through the **OpenAI-compatible** Chat Completions API,
so a laptop HF server, vLLM, or a hosted provider are drop-in replacements.

## Quickstart

```sh
# once (adds torch + transformers for local serving)
make venv-local

# terminal 1: local HF model behind /v1
make run-llm

# terminal 2: the analyzer
make run-analyzer

# terminal 3: use it
go run ./cmd/terra map https://github.com/usememos/memos -o memos.map.json
# or run the HTTP API:
make run-server
curl -X POST localhost:8080/analyze -d '{"repo_url":"https://github.com/usememos/memos"}'
curl localhost:8080/analyses
curl localhost:8080/analyses/1
```

Point `TERRA_LLM_URL` at any other OpenAI-compatible `/v1` endpoint (cloud, vLLM,
Ollama’s OpenAI mode) without changing analyzer code.

## Commands

| Command | What it does |
|---|---|
| `terra scan <url>` | Clone + deterministic scan, JSON to stdout |
| `terra map <url>` | Scan, ask the analyzer for a map, store in `terra.db` |
| `terra serve` | HTTP API: `POST /analyze`, `GET /analyses`, `GET /analyses/{id}` |

## Environment variables

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `TERRA_ANALYZER_URL` | Go | `http://localhost:8010` | Where the Python analyzer listens |
| `TERRA_LLM_URL` | analyzer | `http://localhost:8020/v1` | OpenAI-compatible base URL (`…/v1`) |
| `TERRA_MODEL` | analyzer + local LLM | `Qwen/Qwen2.5-0.5B-Instruct` | Hugging Face model id or path |
| `TERRA_DEVICE` | local LLM | `auto` (`mps` / `cuda` / `cpu`) | Torch device for `make run-llm` |

## Analyzer HTTP surface

| Route | Purpose |
|---|---|
| `GET /healthz` | Status, model, whether the LLM `/v1/models` probe succeeded |
| `POST /analyze` | Architecture map (Go wire contract) |
| `GET /tasks` | Registered agent tasks |
| `POST /tasks/{name}` | Run a named task (`architecture`, …) |

## Tests

```sh
make test        # go test ./... + pytest (skips @pytest.mark.slow)
```

The wire contract between Go and Python is the draft JSON in
`analyzer/terra_analyzer/models.py` mirrored by `internal/graph/types.go`;
the enums and model JSON schema live only in `analyzer/terra_analyzer/schema.py`.
`case-studies/memos.map.json` is the golden answer key and is checked by
`analyzer/tests/test_app.py`.
