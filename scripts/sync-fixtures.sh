#!/usr/bin/env bash
# Keep apps/web/src/data/memos.map.json in sync with the canonical golden map.
#
# Usage:
#   scripts/sync-fixtures.sh          # copy canonical → web
#   scripts/sync-fixtures.sh --check  # fail if they differ (used by make test-fixtures)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/case-studies/memos.map.json"
DST="$ROOT/apps/web/src/data/memos.map.json"

if [[ ! -f "$SRC" ]]; then
  echo "missing canonical fixture: $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -q "$SRC" "$DST" >/dev/null; then
    echo "fixture drift: $DST differs from $SRC" >&2
    echo "run: make sync-fixtures" >&2
    diff -u "$SRC" "$DST" >&2 || true
    exit 1
  fi
  echo "fixtures ok: web copy matches case-studies/memos.map.json"
  exit 0
fi

cp "$SRC" "$DST"
echo "synced $DST ← $SRC"
