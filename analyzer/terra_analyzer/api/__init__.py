"""FastAPI application construction and HTTP routes."""

from .app import create_app

__all__ = ["app", "create_app"]


def __getattr__(name: str):
    # Lazy: importing create_app alone must not build the default app (and its
    # registry → inference cycle) until callers need the ASGI object.
    if name == "app":
        from .app import app

        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
