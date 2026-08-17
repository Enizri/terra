"""OpenAI-compatible inference client."""

from .client import LLMError, chat, preflight
from .config import Config

__all__ = ["Config", "LLMError", "chat", "preflight"]
