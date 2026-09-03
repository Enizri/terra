"""Programmatic harness checkers; no live LLM in CI (live llama.cpp is @pytest.mark.slow)."""

from .ask import assert_memos_ask, load_ask_cases, load_golden_map

__all__ = ["assert_memos_ask", "load_ask_cases", "load_golden_map"]
