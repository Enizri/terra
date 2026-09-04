#!/usr/bin/env bash
# Production-shaped end-to-end smoke run against the Docker Compose stack.
#
# `make check` stubs scan/analyze/preview, so it never exercises the assembled
# deployment. This drives the real thing — one origin on loopback, the token
# gate, a live provider, the terra-data volume, docker-mode preview — through
# the full user loop and asserts each stage.
#
# It builds images, starts containers, fetches real repositories, and spends
# provider tokens, so it is opt-in:
#
#   TERRA_SMOKE=1 make smoke
#
# Read docs first: README.md "Production-shaped playground".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${TERRA_SMOKE:-}" != "1" ]]; then
  cat >&2 <<'MSG'
set TERRA_SMOKE=1 to run the smoke suite.

It builds Compose images, starts containers, fetches GitHub repositories, and
spends provider tokens on a real analyze and ask. Nothing here is free.
MSG
  exit 1
fi

API="${TERRA_SMOKE_API:-http://127.0.0.1:8080}"
REPO="${TERRA_SMOKE_REPO:-https://github.com/reduxjs/redux-essentials-example-app}"
GO_REPO="${TERRA_SMOKE_GO_REPO:-https://github.com/usememos/memos}"
MODEL="${TERRA_SMOKE_MODEL:-openai-gpt-5.4-mini}"

TMP="$(mktemp -d)"
trap 'teardown' EXIT

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

RESULTS=()
CURRENT=""

stage() {
  CURRENT="$1"
  printf 'smoke: %s\n' "$1" >&2
}

pass() {
  RESULTS+=("PASS  $CURRENT${1:+  ($1)}")
}

fail() {
  RESULTS+=("FAIL  $CURRENT  $*")
  printf '\nsmoke: FAILED at "%s": %s\n\n' "$CURRENT" "$*" >&2
  printf -- '--- docker compose logs (tail) ---\n' >&2
  docker compose logs --tail=50 api analyzer 2>&1 | sed 's/^/  /' >&2 || true
  report
  exit 1
}

report() {
  printf '\n--- smoke results ---\n' >&2
  (( ${#RESULTS[@]} )) || return 0
  local line
  for line in "${RESULTS[@]}"; do printf '%s\n' "$line" >&2; done
}

teardown() {
  local code=$?
  rm -rf "$TMP"
  if [[ "${TERRA_SMOKE_KEEP:-}" == "1" ]]; then
    printf 'smoke: TERRA_SMOKE_KEEP=1, leaving the stack up (make down to stop)\n' >&2
  else
    # Never -v: a smoke run must not eat a real terra.db.
    docker compose down >/dev/null 2>&1 || true
  fi
  return $code
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# envval KEY — the value from the process env, else the last match in .env.
envval() {
  local key="$1" val="${!1:-}"
  if [[ -n "$val" ]]; then printf '%s' "$val"; return; fi
  [[ -f .env ]] || return 0
  { grep -E "^${key}=" .env || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

# api METHOD PATH [BODY] — a gated request. Paced: TERRA_RATE_LIMIT is 2/s and
# tripping it mid-suite would be a false failure. Prints "<body>\n<status>".
api() {
  sleep 0.6
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -s -m 120 -w '\n%{http_code}' -X "$method" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "$body" "$API$path"
  else
    curl -s -m 120 -w '\n%{http_code}' -X "$method" \
      -H "Authorization: Bearer $TOKEN" "$API$path"
  fi
}

status_of() { tail -1 <<<"$1"; }
body_of() { sed '$d' <<<"$1"; }

# jget FIELD — read a top-level field from JSON on stdin.
jget() {
  python3 -c '
import json,sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(1)
v = doc.get(sys.argv[1])
if v is None:
    sys.exit(1)
print(v if isinstance(v, str) else json.dumps(v))
' "$1"
}

# stream_job JOB_ID OUTFILE MAX_SECONDS — capture a job's NDJSON event stream.
stream_job() {
  sleep 0.6
  curl -sN -m "$3" -H "Authorization: Bearer $TOKEN" \
    "$API/jobs/$1/events" >"$2" || true
  [[ -s "$2" ]] || fail "job $1 produced no events"
}

# stages FILE — space-separated stage names in order.
stages() {
  python3 -c '
import json,sys
out=[]
for line in open(sys.argv[1]):
    line=line.strip()
    if not line: continue
    try: out.append(json.loads(line).get("stage",""))
    except Exception: pass
print(" ".join(out))
' "$1"
}

# event_field FILE STAGE FIELD — a field from the last event with that stage.
event_field() {
  python3 -c '
import json,sys
found=None
for line in open(sys.argv[1]):
    line=line.strip()
    if not line: continue
    try: ev=json.loads(line)
    except Exception: continue
    if ev.get("stage")==sys.argv[2] and ev.get(sys.argv[3]) is not None:
        found=ev[sys.argv[3]]
if found is None: sys.exit(1)
print(found if isinstance(found,str) else json.dumps(found))
' "$1" "$2" "$3"
}

has_stage() { [[ " $(stages "$1") " == *" $2 "* ]]; }

# analyzer_calls — how many times the Go API has reached the analyzer. uvicorn
# access-logs every request and the container healthcheck only hits /healthz,
# so this counts real work. The analyzer never logs the completions call itself.
analyzer_calls() {
  { docker compose logs analyzer 2>&1 | grep -cE 'POST /(analyze|tasks/)' || true; }
}

# no_error FILE — fail if the stream carried an error event.
no_error() {
  if has_stage "$1" error; then
    fail "job errored: $(event_field "$1" error label || echo 'unknown error')"
  fi
}

# ---------------------------------------------------------------------------
# Preflight — fail before building anything
# ---------------------------------------------------------------------------

stage "preflight"

command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"
command -v python3 >/dev/null || fail "python3 is required"
command -v curl >/dev/null || fail "curl is required"

[[ -f .env ]] || fail ".env is missing; start from .env.example"

TOKEN="$(envval TERRA_TOKEN)"
LLM_URL="$(envval TERRA_LLM_URL)"
LLM_KEY="$(envval TERRA_LLM_API_KEY)"

# Compose binds 0.0.0.0 and `terra serve` refuses that with an empty token, so
# an empty value would surface as a container crash-loop, not a clear error.
[[ -n "$TOKEN" ]] || fail "TERRA_TOKEN must be set in .env (Compose binds 0.0.0.0)"
[[ -n "$LLM_URL" ]] || fail "TERRA_LLM_URL must be set in .env (hosted OpenAI-compatible /v1)"
[[ -n "$LLM_KEY" ]] || fail "TERRA_LLM_API_KEY must be set in .env for a hosted endpoint"
case "$LLM_URL" in
  *localhost*|*127.0.0.1*)
    fail "TERRA_LLM_URL points at localhost; inside the analyzer container that is the analyzer itself"
    ;;
esac

pass "token, hosted LLM, docker, python3"

# ---------------------------------------------------------------------------
# 1. Boot
# ---------------------------------------------------------------------------

stage "1 boot"

docker compose up --build -d >/dev/null 2>&1 || fail "docker compose up failed"

deadline=$((SECONDS + 180))
until curl -sf -m 5 "$API/healthz" | grep -q '"status":"ok"'; do
  (( SECONDS < deadline )) || fail "api never became healthy within 180s"
  sleep 3
done

docker compose ps analyzer | grep -q 'healthy' || fail "analyzer container is not healthy"

# The analyzer's startup preflight prints model=/base_url= and then either
# "llm reachable" or "llm UNREACHABLE: ..." (api/app.py::_lifespan). Assert the
# positive, and name the two failures the README's troubleshooting table lists.
logs="$(docker compose logs analyzer 2>&1)"
grep -q 'model=.*base_url=' <<<"$logs" || fail "analyzer never logged its model/base_url"
if grep -qE 'serving .*, not ' <<<"$logs"; then fail "TERRA_MODEL does not match what the endpoint serves"; fi
if grep -q 'points at localhost' <<<"$logs"; then fail "TERRA_LLM_URL is localhost inside the container"; fi
if grep -q 'llm UNREACHABLE' <<<"$logs"; then fail "analyzer cannot reach TERRA_LLM_URL (check the key)"; fi
grep -q 'llm reachable' <<<"$logs" || fail "analyzer did not confirm the provider is reachable"

pass "api healthy, analyzer reached the provider"

# ---------------------------------------------------------------------------
# 2. Auth gate
# ---------------------------------------------------------------------------

stage "2 auth gate"

code() { sleep 0.6; curl -s -m 15 -o /dev/null -w '%{http_code}' "$@"; }

[[ "$(code "$API/analyses")" == "401" ]] || fail "GET /analyses without a token should be 401"
for open_path in /healthz /models /host/capabilities; do
  [[ "$(code "$API$open_path")" == "200" ]] || fail "GET $open_path should stay open"
done

sleep 0.6
headers="$(curl -s -m 15 -D - -o /dev/null "$API/")"
grep -qi '^HTTP/[0-9.]* 200' <<<"$headers" || fail "GET / should serve the built SPA"
grep -qi 'set-cookie:.*HttpOnly' <<<"$headers" || fail "GET / should set the HttpOnly access cookie"

resp="$(api GET /analyses)"
[[ "$(status_of "$resp")" == "200" ]] || fail "GET /analyses with a token should be 200"

pass "401 without token, open routes open, HttpOnly cookie set"

# ---------------------------------------------------------------------------
# 3. Probe — the hard gate, no tokens spent
# ---------------------------------------------------------------------------

stage "3 probe (no LLM call)"

calls_before="$(analyzer_calls)"

resp="$(api POST /jobs/probe "{\"repo_url\":\"$REPO\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /jobs/probe: $(body_of "$resp")"
job_id="$(body_of "$resp" | jget job_id)" || fail "probe returned no job_id"

stream_job "$job_id" "$TMP/probe.ndjson" 600
no_error "$TMP/probe.ndjson"
has_stage "$TMP/probe.ndjson" fetch || fail "probe never emitted fetch"
has_stage "$TMP/probe.ndjson" scan || fail "probe never emitted scan"
has_stage "$TMP/probe.ndjson" done || fail "probe never reached done"

PROBE_ID="$(event_field "$TMP/probe.ndjson" done probe_id)" || fail "done carried no probe_id"
event_field "$TMP/probe.ndjson" done repo >/dev/null || fail "done carried no repo"
event_field "$TMP/probe.ndjson" done recommendation >/dev/null || fail "done carried no recommendation"

calls_after="$(analyzer_calls)"
[[ "$calls_before" == "$calls_after" ]] \
  || fail "probe reached the analyzer ($calls_before → $calls_after); the gate is supposed to spend nothing"

pass "fetch → scan → done, probe_id + recommendation, analyzer never called"

# ---------------------------------------------------------------------------
# 4. Analyze (BYOK)
# ---------------------------------------------------------------------------

stage "4 analyze"

calls_before="$(analyzer_calls)"

resp="$(api POST /jobs/analyze \
  "{\"repo_url\":\"$REPO\",\"probe_id\":\"$PROBE_ID\",\"model_id\":\"$MODEL\",\"api_key\":\"$LLM_KEY\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /jobs/analyze: $(body_of "$resp")"
job_id="$(body_of "$resp" | jget job_id)" || fail "analyze returned no job_id"

stream_job "$job_id" "$TMP/analyze.ndjson" 1200
no_error "$TMP/analyze.ndjson"
has_stage "$TMP/analyze.ndjson" done || fail "analyze never reached done"

event_field "$TMP/analyze.ndjson" done map >"$TMP/map.json" || fail "done carried no map"
python3 -c '
import json,sys
m=json.load(open(sys.argv[1]))
for k in ("project","components","relationships"):
    if not m.get(k): raise SystemExit(f"map.{k} is empty")
if not any(c.get("files") for c in m["components"]):
    raise SystemExit("no component carries evidence file paths")
' "$TMP/map.json" || fail "analyze produced a map that fails the contract"

# The probe stage's assertion is only worth something if this counter moves.
(( "$(analyzer_calls)" > calls_before )) \
  || fail "analyze did not reach the analyzer; the probe-gate check above is vacuous"

# scrub() under a real provider: no unit test can prove this.
if grep -qF "$LLM_KEY" "$TMP/analyze.ndjson"; then fail "the API key leaked into the job event stream"; fi
if docker compose logs api analyzer 2>&1 | grep -qF "$LLM_KEY"; then fail "the API key leaked into container logs"; fi

pass "map with components, relationships and evidence; key never echoed"

# ---------------------------------------------------------------------------
# 5. Persistence across a restart
# ---------------------------------------------------------------------------

stage "5 persistence across restart"

resp="$(api GET /analyses)"
[[ "$(status_of "$resp")" == "200" ]] || fail "GET /analyses: $(body_of "$resp")"
ANALYSIS_ID="$(body_of "$resp" | python3 -c '
import json,sys
rows=json.load(sys.stdin) or []
want=sys.argv[1].rstrip("/").lower()
slug="/".join(want.split("/")[-2:])
for row in rows:
    if slug in (row.get("repo_url") or "").lower():
        print(row["id"]); break
else:
    raise SystemExit(1)
' "$REPO")" || fail "GET /analyses has no row for $REPO"

resp="$(api GET "/analyses/$ANALYSIS_ID")"
before="$(body_of "$resp")"
[[ "$(status_of "$resp")" == "200" ]] || fail "GET /analyses/$ANALYSIS_ID: $before"

docker compose restart api >/dev/null 2>&1 || fail "docker compose restart api failed"
deadline=$((SECONDS + 120))
until curl -sf -m 5 "$API/healthz" | grep -q '"status":"ok"'; do
  (( SECONDS < deadline )) || fail "api never came back after restart"
  sleep 3
done

resp="$(api GET "/analyses/$ANALYSIS_ID")"
[[ "$(status_of "$resp")" == "200" ]] || fail "the analysis did not survive the restart: $(body_of "$resp")"
canon() { python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin),sort_keys=True))'; }
diff <(canon <<<"$before") <(canon <<<"$(body_of "$resp")") >/dev/null \
  || fail "the stored map changed across the restart"

pass "terra.db on the terra-data volume survived a container restart"

# ---------------------------------------------------------------------------
# 6. Ask + agent
# ---------------------------------------------------------------------------

stage "6 ask and agent"

resp="$(api POST /jobs/ask \
  "{\"repo_url\":\"$REPO\",\"question\":\"What does this project do?\",\"model_id\":\"$MODEL\",\"api_key\":\"$LLM_KEY\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /jobs/ask: $(body_of "$resp")"
job_id="$(body_of "$resp" | jget job_id)" || fail "ask returned no job_id"
stream_job "$job_id" "$TMP/ask.ndjson" 600
no_error "$TMP/ask.ndjson"
answer="$(event_field "$TMP/ask.ndjson" done answer || true)"
[[ -n "$answer" ]] || fail "ask produced no answer"

resp="$(api POST /jobs/agent \
  "{\"repo_url\":\"$REPO\",\"question\":\"Where does the app start?\",\"model_id\":\"$MODEL\",\"api_key\":\"$LLM_KEY\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /jobs/agent: $(body_of "$resp")"
job_id="$(body_of "$resp" | jget job_id)" || fail "agent returned no job_id"
stream_job "$job_id" "$TMP/agent.ndjson" 900
no_error "$TMP/agent.ndjson"
[[ -n "$(event_field "$TMP/agent.ndjson" done answer || true)" ]] || fail "agent produced no answer"

if grep -qF "$LLM_KEY" "$TMP/ask.ndjson" "$TMP/agent.ndjson"; then fail "the API key leaked into ask/agent events"; fi

pass "ask and the read-only guide both answered"

# ---------------------------------------------------------------------------
# 7. Live preview (docker mode)
# ---------------------------------------------------------------------------

stage "7 live preview (docker mode)"

resp="$(api POST /jobs/preview "{\"repo_url\":\"$REPO\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /jobs/preview: $(body_of "$resp")"
job_id="$(body_of "$resp" | jget job_id)" || fail "preview returned no job_id"

# A real npm install inside a sibling container; give it room.
stream_job "$job_id" "$TMP/preview.ndjson" 900
no_error "$TMP/preview.ndjson"
for want in checkout detect install boot ready; do
  has_stage "$TMP/preview.ndjson" "$want" || fail "preview never emitted $want"
done

PREVIEW_URL="$(event_field "$TMP/preview.ndjson" ready label)" || fail "ready carried no url"
python3 -c '
import json,sys
res=json.loads(sys.argv[1])
if not res.get("url"): raise SystemExit("ready.preview has no url")
if not res.get("primary_id"): raise SystemExit("ready.preview has no primary_id")
if not res.get("apps"): raise SystemExit("ready.preview has no apps")
' "$(event_field "$TMP/preview.ndjson" ready preview)" || fail "ready payload is incomplete"

sleep 0.6
live_code="$(curl -s -m 30 -o "$TMP/live.html" -w '%{http_code}' "$PREVIEW_URL")"
[[ "$live_code" == "200" ]] || fail "GET $PREVIEW_URL returned $live_code"
grep -qi '<html\|<!doctype' "$TMP/live.html" || fail "the live URL did not serve HTML"

siblings="$({ docker ps --filter network=terra-net --format '{{.Names}}' \
  | grep -vE 'terra[-_](api|analyzer|llm)' || true; } | wc -l)"
(( siblings >= 1 )) || fail "no sibling preview container on terra-net"
max="${TERRA_PREVIEW_MAX:-2}"
(( siblings <= max )) || fail "TERRA_PREVIEW_MAX=$max but $siblings preview containers are running"

pass "checkout → ready, /__live/ served HTML, $siblings sibling container(s)"

# ---------------------------------------------------------------------------
# 7b. Go/Python preview must fail cleanly, not hang
# ---------------------------------------------------------------------------

if [[ "${TERRA_SMOKE_SKIP_GO:-}" == "1" ]]; then
  stage "7b go preview fails cleanly"
  pass "skipped (TERRA_SMOKE_SKIP_GO=1)"
else
  stage "7b go preview fails cleanly"

  # dockerable() is false for Go and Python, so docker.go falls back to
  # startHostApp inside the api container — debian-slim with neither toolchain.
  # This cannot work today. Pin that it fails as a readable error, and that the
  # api survives it. The sandbox work turns this stage green.
  #
  # Stage 7 already holds preview slots, so TERRA_PREVIEW_MAX may refuse this
  # boot before the toolchain ever comes up. Either way the requirement is the
  # same — a readable refusal, not a hang — and the label below says which.
  resp="$(api POST /jobs/preview "{\"repo_url\":\"$GO_REPO\"}")"
  [[ "$(status_of "$resp")" == "200" ]] || fail "POST /jobs/preview (go repo): $(body_of "$resp")"
  job_id="$(body_of "$resp" | jget job_id)" || fail "go preview returned no job_id"
  stream_job "$job_id" "$TMP/preview-go.ndjson" 900

  if has_stage "$TMP/preview-go.ndjson" ready; then
    note="unexpectedly booted — the api image grew a Go toolchain, or detection changed"
  else
    has_stage "$TMP/preview-go.ndjson" error || fail "go preview neither booted nor errored (it hung)"
    label="$(event_field "$TMP/preview-go.ndjson" error label || true)"
    [[ -n "$label" ]] || fail "go preview errored with an empty label"
    note="clean refusal: $(cut -c1-60 <<<"$label")"
  fi
  curl -sf -m 10 "$API/healthz" >/dev/null || fail "the api did not survive the go preview attempt"

  pass "$note"
fi

# ---------------------------------------------------------------------------
# 8. Route console
# ---------------------------------------------------------------------------

stage "8 route console"

resp="$(api GET "/preview/routes?repo_url=$REPO")"
[[ "$(status_of "$resp")" == "200" ]] || fail "GET /preview/routes: $(body_of "$resp")"
body_of "$resp" | python3 -c '
import json,sys
doc=json.load(sys.stdin)
if "routes" not in doc: raise SystemExit("no routes key")
' || fail "/preview/routes returned no routes"

resp="$(api POST /preview/probe \
  "{\"repo_url\":\"$REPO\",\"url\":\"$PREVIEW_URL\",\"method\":\"GET\",\"path\":\"/\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /preview/probe: $(body_of "$resp")"

pass "routes discovered, probe hit the live app"

# ---------------------------------------------------------------------------
# 9. Editor write path
# ---------------------------------------------------------------------------

stage "9 editor write path"

marker="terra-smoke-$$"
resp="$(api POST /preview/patch \
  "{\"repo_url\":\"$REPO\",\"path\":\"terra-smoke.txt\",\"unified_diff\":\"@@ -0,0 +1,1 @@\\n+$marker\\n\"}")"
[[ "$(status_of "$resp")" == "200" ]] || fail "POST /preview/patch: $(body_of "$resp")"

# /files resolves against the app dir, patch against the checkout root. They
# match for a root app; a nested one is a skip, not a failure.
resp="$(api GET "/files?repo_url=$REPO&path=terra-smoke.txt")"
if [[ "$(status_of "$resp")" == "200" ]]; then
  grep -qF "$marker" <<<"$(body_of "$resp")" || fail "the patched file does not contain what was written"
  readback="read back through GET /files"
else
  readback="read-back skipped (app dir is not the checkout root)"
fi

resp="$(api POST /preview/restart "{\"repo_url\":\"$REPO\"}")"
case "$(status_of "$resp")" in
  200|204) ;;
  *) fail "POST /preview/restart: $(body_of "$resp")" ;;
esac

deadline=$((SECONDS + 120))
until [[ "$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$PREVIEW_URL")" == "200" ]]; do
  (( SECONDS < deadline )) || fail "the preview did not come back after restart"
  sleep 3
done

# The boundary docs/SECURITY.md promises, against a live checkout.
resp="$(api POST /preview/patch \
  "{\"repo_url\":\"$REPO\",\"path\":\"../../etc/passwd\",\"unified_diff\":\"@@ -0,0 +1,1 @@\\n+pwned\\n\"}")"
[[ "$(status_of "$resp")" == "400" ]] || fail "a path escape was not rejected with 400: $(body_of "$resp")"
if docker compose exec -T api grep -q pwned /etc/passwd 2>/dev/null; then fail "a path escape wrote outside the checkout"; fi

pass "$readback, restart recovered, path escape rejected"

# ---------------------------------------------------------------------------
# 10. Rate limit — last, it drains the bucket
# ---------------------------------------------------------------------------

stage "10 rate limit"

saw429=0
for _ in $(seq 1 40); do
  if [[ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer $TOKEN" "$API/analyses")" == "429" ]]; then
    saw429=1
    break
  fi
done
(( saw429 == 1 )) || fail "40 rapid requests never got a 429 (TERRA_RATE_LIMIT off?)"

pass "the limiter rejected a burst from one address"

# ---------------------------------------------------------------------------

report
printf '\nsmoke: all stages passed against %s\n' "$API" >&2
