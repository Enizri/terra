"""Terra analyzer HTTP service (Go backend client)."""

import contextlib
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException

from . import llm
from .agents import default_registry
from .inference.config import Config
from .models import AnalyzeRequest, AnalyzeResponse


def _in_container() -> bool:
    return Path("/.dockerenv").exists()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
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
            from .inference.client import preflight

            preflight(cfg)
            print("terra-analyzer: llm reachable", file=sys.stderr)
        except Exception as e:
            print(
                f"terra-analyzer: llm UNREACHABLE: {e} — /analyze will fail with this error",
                file=sys.stderr,
            )
    finally:
        cfg.client.close()
    yield


app = FastAPI(title="terra-analyzer", lifespan=lifespan)
registry = default_registry()


@app.get("/")
def root() -> dict:
    return {"service": "terra-analyzer", "status": "ok"}


@app.get("/healthz")
def healthz() -> dict:
    cfg = Config(client=httpx.Client(timeout=2.0))
    llm_ok = False
    llm_error = None
    try:
        from .inference.client import preflight

        preflight(cfg)
        llm_ok = True
    except Exception as e:
        llm_error = str(e)
    finally:
        cfg.client.close()
    return {
        "status": "ok",
        "model": cfg.model,
        "llm_url": cfg.base_url,
        "llm_ok": llm_ok,
        "llm_error": llm_error,
        "tasks": registry.list(),
    }


@app.get("/tasks")
def list_tasks() -> dict:
    return {"tasks": registry.list()}


@app.post("/tasks/{name}")
def run_task(name: str, payload: dict) -> dict:
    if registry.get(name) is None:
        raise HTTPException(status_code=404, detail=f'unknown task "{name}"')
    try:
        return registry.run(name, payload)
    except llm.LLMError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """Go wire contract: architecture task facade."""
    try:
        draft, warnings = llm.generate(
            req.scan, model=req.model, base_url=req.base_url, api_key=req.api_key
        )
    except llm.LLMError as e:
        # Go prints detail verbatim.
        raise HTTPException(status_code=502, detail=str(e)) from e
    return AnalyzeResponse(draft=draft, warnings=warnings)
