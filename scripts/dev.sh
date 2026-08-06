#!/usr/bin/env bash
# Run Terra local processes from Procfile.dev with prefixed logs.
# Usage:
#   scripts/dev.sh              # all processes in Procfile.dev
#   scripts/dev.sh llm analyzer api   # subset (make dev-api)
set -euo pipefail
set -m  # each background job gets its own process group (clean Ctrl-C)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROCFILE="${ROOT}/Procfile.dev"
cd "$ROOT"

if [[ ! -f "$PROCFILE" ]]; then
  echo "missing ${PROCFILE}" >&2
  exit 1
fi

if [[ ! -x analyzer/.venv/bin/uvicorn ]]; then
  echo "analyzer/.venv is missing; run: make venv-local" >&2
  exit 1
fi

# Optional filter: only start named processes.
filter=("$@")
want() {
  local name="$1"
  if ((${#filter[@]} == 0)); then
    return 0
  fi
  local item
  for item in "${filter[@]}"; do
    if [[ "$item" == "$name" ]]; then
      return 0
    fi
  done
  return 1
}

pids=()
names=()

cleanup() {
  trap - INT TERM EXIT
  local pid
  for pid in "${pids[@]+"${pids[@]}"}"; do
    # Negative PID = whole process group (uvicorn/go/npm children included).
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

prefix_stream() {
  local name="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '[%s] %s\n' "$name" "$line"
  done
}

started=0
while IFS= read -r raw || [[ -n "$raw" ]]; do
  [[ -z "${raw//[[:space:]]/}" || "$raw" =~ ^[[:space:]]*# ]] && continue
  name="${raw%%:*}"
  cmd="${raw#*:}"
  name="${name#"${name%%[![:space:]]*}"}"
  name="${name%"${name##*[![:space:]]}"}"
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  cmd="${cmd%"${cmd##*[![:space:]]}"}"
  [[ -z "$name" || -z "$cmd" ]] && continue
  want "$name" || continue

  (
    bash -c "$cmd" 2>&1 | prefix_stream "$name"
  ) &
  pids+=($!)
  names+=("$name")
  started=$((started + 1))
done < "$PROCFILE"

if ((started == 0)); then
  echo "no processes matched; check Procfile.dev or the names you passed" >&2
  exit 1
fi

echo "dev: started ${names[*]} (Ctrl-C to stop)"
for name in "${names[@]}"; do
  case "$name" in
    llm) echo "  llm       http://localhost:8020/v1" ;;
    analyzer) echo "  analyzer  http://localhost:8010" ;;
    api) echo "  api       http://localhost:8080" ;;
    web) echo "  web       (vite; see [web] logs for the URL)" ;;
  esac
done
echo "  tip: first LLM boot downloads/loads the model and can take a while"

while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || true
      echo "dev: a process exited; shutting down the rest" >&2
      exit 1
    fi
  done
  sleep 1
done
