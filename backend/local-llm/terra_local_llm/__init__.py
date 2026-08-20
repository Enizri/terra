"""Optional local GGUF OpenAI-compatible server (separate process from the analyzer)."""

from .server import app, load_model, pick_device

__all__ = ["app", "load_model", "pick_device"]
