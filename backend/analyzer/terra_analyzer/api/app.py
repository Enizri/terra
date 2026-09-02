"""Terra analyzer HTTP service (Go backend client)."""

import contextlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from ..contracts import AnalyzeRequest, AnalyzeResponse
from ..inference.client import LLMError
from ..inference.config import Config
from ..runtime import PolicyError
from ..tasks.registry import TaskRegistry, default_registry


def _in_container() -> bool:
    return Path("/.dockerenv").exists()


@contextlib.asynccontextmanager
async def _lifespan(_app: FastAPI):
    cfg = Config(client=httpx.Client(timeout=5.0))
    try:
        print(
            f"terra-analyzer: model={cfg.model} base_url={cfg.base_url} "
            f"api_key={'set' if cfg.api_key_set else 'unset'}",
            file=sys.stderr,
        )
        host = urlparse(cfg.base_url).hostname
        if host in ("localhost", "127.0.0.1") and _in_container():
            raise RuntimeError(
                f"TERRA_LLM_URL={cfg.base_url} points at localhost, but inside a "
                "container that is the analyzer itself. Use a hosted provider URL "
                "(https://api.openai.com/v1) or http://llm:8020/v1 for the Compose llm profile."
            )
        try:
            from ..inference.client import LLMError, preflight

            preflight(cfg)
            print("terra-analyzer: llm reachable", file=sys.stderr)
        except LLMError as e:
            print(
                f"terra-analyzer: llm UNREACHABLE: {e} — /analyze will fail with this error",
                file=sys.stderr,
            )
    finally:
        cfg.client.close()
    yield


def create_app(registry: TaskRegistry | None = None) -> FastAPI:
    """Build the FastAPI app, optionally injecting a task registry (for tests)."""
    reg = registry if registry is not None else default_registry()
    application = FastAPI(title="terra-analyzer", lifespan=_lifespan)
    application.state.registry = reg

    @application.get("/")
    def root() -> dict:
        return {"service": "terra-analyzer", "status": "ok"}

    @application.get("/healthz")
    def healthz() -> dict:
        cfg = Config(client=httpx.Client(timeout=2.0))
        llm_ok = False
        llm_error = None
        try:
            from ..inference.client import LLMError, preflight

            preflight(cfg)
            llm_ok = True
        except LLMError as e:
            llm_error = str(e)
        finally:
            cfg.client.close()
        return {
            "status": "ok",
            "model": cfg.model,
            "llm_url": cfg.base_url,
            "llm_ok": llm_ok,
            "llm_error": llm_error,
            "tasks": application.state.registry.list(),
        }

    @application.get("/tasks")
    def list_tasks() -> dict:
        return {"tasks": application.state.registry.list()}

    @application.post("/tasks/{name}")
    def run_task(name: str, payload: dict):
        task = application.state.registry.get(name)
        if task is None:
            raise HTTPException(status_code=404, detail=f'unknown task "{name}"')
        stream = getattr(task, "run_stream", None)
        if callable(stream):
            return _stream_task(stream, payload)
        try:
            return application.state.registry.run(name, payload)
        except LLMError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e
        except PolicyError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @application.post("/analyze", response_model=AnalyzeResponse)
    def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
        """Go wire contract: architecture task facade via TaskRegistry."""
        try:
            out = application.state.registry.run(
                "architecture",
                {
                    "scan": req.scan,
                    "model": req.model,
                    "base_url": req.base_url,
                    "api_key": req.api_key,
                },
            )
        except LLMError as e:
            # Go prints detail verbatim.
            raise HTTPException(status_code=502, detail=str(e)) from e
        return AnalyzeResponse(draft=out["draft"], warnings=out["warnings"])

    return application


def _stream_task(stream, payload: dict) -> StreamingResponse:
    """NDJSON `{stage, label}` lines, then `{answer}`. Peek so validation is 400."""
    try:
        iterator = stream(payload)
        first = next(iterator)
    except StopIteration:
        first = None
        iterator = iter(())
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except PolicyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    def gen():
        try:
            if first is not None:
                yield json.dumps(first) + "\n"
            for event in iterator:
                yield json.dumps(event) + "\n"
        except LLMError as e:
            yield json.dumps({"error": str(e)}) + "\n"
        except PolicyError as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


app = create_app()
# Exposed for tests that monkeypatch registry methods on the default app.
registry: TaskRegistry = app.state.registry
