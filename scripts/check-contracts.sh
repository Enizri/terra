#!/usr/bin/env bash
# Validate versioned wire fixtures against schemas and language-native types.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "check-contracts: $*" >&2; exit 1; }
command -v python3 >/dev/null || fail "python3 required"

python3 - <<'PY'
import json, sys
from pathlib import Path

fixtures = {
    "contracts/fixtures/analysis-map.v1.json": "contracts/analysis-map/v1.schema.json",
    "contracts/fixtures/analyzer-request.v1.json": "contracts/analyzer/v1/request.schema.json",
    "contracts/fixtures/analyzer-response.v1.json": "contracts/analyzer/v1/response.schema.json",
}

try:
    from jsonschema import Draft202012Validator
    have_jsonschema = True
except ImportError:
    have_jsonschema = False
    print("check-contracts: jsonschema not installed; structural checks only", file=sys.stderr)

def structural_map(doc):
    for k in ("project", "components", "relationships", "suggested_questions"):
        if k not in doc:
            raise SystemExit(f"analysis-map missing {k}")
    if not doc["components"]:
        raise SystemExit("analysis-map components empty")

def structural_req(doc):
    if "scan" not in doc:
        raise SystemExit("analyzer request missing scan")
    scan = doc["scan"]
    for k in ("repository_url", "name", "stats", "languages", "primary_languages", "tree", "dependencies", "files"):
        if k not in scan:
            raise SystemExit(f"scan missing {k}")

def structural_resp(doc):
    if "draft" not in doc:
        raise SystemExit("analyzer response missing draft")
    d = doc["draft"]
    for k in ("description", "kind", "components", "relationships", "suggested_questions"):
        if k not in d:
            raise SystemExit(f"draft missing {k}")

checks = {
    "contracts/fixtures/analysis-map.v1.json": structural_map,
    "contracts/fixtures/analyzer-request.v1.json": structural_req,
    "contracts/fixtures/analyzer-response.v1.json": structural_resp,
}

for fix, schema_path in fixtures.items():
    doc = json.loads(Path(fix).read_text())
    checks[fix](doc)
    if have_jsonschema:
        schema = json.loads(Path(schema_path).read_text())
        Draft202012Validator(schema).validate(doc)

golden = json.loads(Path("case-studies/memos.map.json").read_text())
golden_stripped = {k: v for k, v in golden.items() if not str(k).startswith("$")}
fixture = json.loads(Path("contracts/fixtures/analysis-map.v1.json").read_text())
if fixture != golden_stripped:
    raise SystemExit("contracts/fixtures/analysis-map.v1.json drifts from case-studies/memos.map.json")

print("check-contracts: schemas/fixtures ok")
PY

echo "check-contracts: Go fixtures"
go test ./internal/analysis/ -run 'TestContractFixtures|TestGoldenMapParses|TestDecodeMapJSON' -count=1

echo "check-contracts: Python fixtures"
PY=python3
if "$ROOT/analyzer/.venv/bin/python" -c 'import sys' >/dev/null 2>&1; then
  PY="$ROOT/analyzer/.venv/bin/python"
fi
(cd "$ROOT/analyzer" && PYTHONPATH=. "$PY" -m pytest -q tests/test_contracts.py)

echo "check-contracts: TypeScript fixtures"
(cd web && npm install --silent && node --test src/features/architecture-map/contract.test.ts)

echo "check-contracts: all languages accept fixtures"
