"""Uvicorn entry point: `uvicorn terra_analyzer.app:app`."""

from .api.app import app, create_app, registry

__all__ = ["app", "create_app", "registry"]
