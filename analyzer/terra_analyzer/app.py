"""Terra analyzer HTTP service (Go backend client)."""

from fastapi import FastAPI, HTTPException

from . import llm
from .agents import default_registry
from .inference.config import Config
from .models import AnalyzeRequest, AnalyzeResponse

app = FastAPI(title="terra-analyzer")
registry = default_registry()


@app.get("/")
def root() -> dict:
    return {"service": "terra-analyzer", "status": "ok"}


@app.get("/healthz")
def healthz() -> dict:
    import httpx

    cfg = Config(client=httpx.Client(timeout=2.0))
    llm_ok = False
    try:
        from .inference.client import preflight

        preflight(cfg)
        llm_ok = True
    except Exception:
        llm_ok = False
    finally:
        cfg.client.close()
    return {
        "status": "ok",
        "model": cfg.model,
        "llm_url": cfg.base_url,
        "llm_ok": llm_ok,
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
        draft, warnings = llm.generate(req.scan, model=req.model)
    except llm.LLMError as e:
        # Go prints detail verbatim.
        raise HTTPException(status_code=502, detail=str(e)) from e
    return AnalyzeResponse(draft=draft, warnings=warnings)
