#!/usr/bin/env bash
# Opt-in live/integration tests (network + running LLM).
#
# Gate with either:
#   TERRA_INTEGRATION=1   # preferred umbrella
#   TERRA_LIVE=1          # Go live GitHub checkout only (legacy alias)
#   TERRA_SLOW=1          # Python live LLM only (legacy alias)
#
# TERRA_INTEGRATION=1 enables both. Legacy vars still work alone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

want_live=0
want_slow=0
if [[ "${TERRA_INTEGRATION:-}" == "1" ]]; then
  want_live=1
  want_slow=1
fi
if [[ "${TERRA_LIVE:-}" == "1" ]]; then
  want_live=1
fi
if [[ "${TERRA_SLOW:-}" == "1" ]]; then
  want_slow=1
fi

if ((want_live == 0 && want_slow == 0)); then
  echo "set TERRA_INTEGRATION=1 (or TERRA_LIVE=1 / TERRA_SLOW=1) to run live tests" >&2
  exit 1
fi

if ((want_live == 1)); then
  echo "integration: Go live checkout (TERRA_LIVE)"
  (cd backend/api && TERRA_LIVE=1 go test -run TestLiveCheckout ./internal/scan/)
fi

if ((want_slow == 1)); then
  if [[ ! -x backend/.venv/bin/python ]]; then
    echo "backend/.venv missing; run: make venv" >&2
    exit 1
  fi
  echo "integration: Python live LLM (TERRA_SLOW)"
  cd backend/analyzer && TERRA_SLOW=1 ../.venv/bin/python -m pytest -q tests/test_slow_llm.py
fi
