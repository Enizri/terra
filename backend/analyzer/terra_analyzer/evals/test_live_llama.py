"""Optional live Completions against llama.cpp. Marked slow; skipped in CI."""

import os

import httpx
import pytest

from terra_analyzer.inference.client import LLMError, complete, preflight
from terra_analyzer.inference.config import Config

pytestmark = pytest.mark.slow


@pytest.fixture
def live_cfg():
    if os.environ.get("TERRA_INTEGRATION") != "1" and os.environ.get("TERRA_SLOW") != "1":
        pytest.skip("set TERRA_INTEGRATION=1 (or TERRA_SLOW=1) to run against a live local LLM")
    base = os.environ.get("TERRA_LLM_URL", "http://localhost:8020/v1")
    cfg = Config(base_url=base, client=httpx.Client(timeout=120))
    try:
        preflight(cfg)
    except (LLMError, httpx.HTTPError, OSError) as e:
        pytest.skip(f"local LLM not reachable at {cfg.base_url}: {e}")
    return cfg


def test_live_complete_returns_text(live_cfg):
    turn = complete(
        live_cfg,
        [
            {"role": "system", "content": "Reply with a tiny JSON object only."},
            {"role": "user", "content": 'Return {"ok": true}'},
        ],
        tools=None,
    )
    assert (turn.content or "").strip()
