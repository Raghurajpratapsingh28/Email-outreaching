#!/usr/bin/env bash
#
# Starts the whole stack: Postgres, Redis, backend API, email worker, and the
# Next.js frontend — in that order, waiting for each dependency to actually be
# reachable before starting the thing that depends on it.
#
# Usage:
#   ./up.sh          start everything
#   ./up.sh --logs   start everything, then tail all logs (Ctrl-C to stop tailing;
#                    processes keep running in the background)
#
# Logs land in ./log/*.log. down.sh finds processes by matching their command
# line (pgrep -f), not PID files — simpler and self-healing if a PID file
# ever went stale.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$ROOT/web"
LOG_DIR="$ROOT/log"
mkdir -p "$LOG_DIR"

API_PORT="${PORT:-3000}"
WEB_PORT="3001"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
info()  { color "34" "==> $1"; }
ok()    { color "32" "✓ $1"; }
warn()  { color "33" "! $1"; }
fail()  { color "31" "✗ $1"; exit 1; }

wait_for() {
  # wait_for <description> <check-command> <timeout-seconds>
  local desc="$1" check="$2" timeout="${3:-20}" elapsed=0
  until eval "$check" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$timeout" ]; then
      fail "$desc did not become ready within ${timeout}s"
    fi
  done
}

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
}

# --- 0. Pre-flight -----------------------------------------------------------

[ -f "$ROOT/.env" ] || fail "$ROOT/.env not found — copy .env.example to .env and fill in your values first"
[ -f "$WEB/.env.local" ] || fail "$WEB/.env.local not found — copy web/.env.example to web/.env.local first"
[ -d "$ROOT/node_modules" ] || fail "backend dependencies not installed — run 'npm install' in $ROOT first"
[ -d "$WEB/node_modules" ] || fail "frontend dependencies not installed — run 'npm install' in $WEB first"

# --- 1. Postgres ---------------------------------------------------------

info "Checking Postgres..."
if command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  ok "Postgres already running"
elif command -v brew >/dev/null 2>&1; then
  brew services start postgresql@14 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
  info "Waiting for Postgres..."
  wait_for "Postgres" "pg_isready -q" 30
  ok "Postgres up"
else
  warn "Could not auto-start Postgres (no brew, and pg_isready failed) — make sure it's running yourself"
fi

# --- 2. Redis --------------------------------------------------------------

info "Checking Redis..."
if command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1; then
  ok "Redis already running"
elif command -v brew >/dev/null 2>&1; then
  brew services start redis >/dev/null 2>&1 || true
  info "Waiting for Redis..."
  wait_for "Redis" "redis-cli ping | grep -q PONG" 30
  ok "Redis up"
else
  warn "Could not auto-start Redis (no brew, and redis-cli ping failed) — make sure it's running yourself"
fi

# --- 3. Database migrations --------------------------------------------------

info "Applying database migrations..."
(cd "$ROOT" && npm run db:migrate --silent) >"$LOG_DIR/migrate.log" 2>&1 \
  || fail "migrations failed — see $LOG_DIR/migrate.log"
ok "Migrations applied"

# --- 4. Backend API ----------------------------------------------------------

if port_in_use "$API_PORT"; then
  warn "Port $API_PORT already in use — assuming the API is already running, skipping"
else
  info "Starting backend API (port $API_PORT)..."
  cd "$ROOT"
  nohup npx tsx src/server.ts >"$LOG_DIR/api.log" 2>&1 &
  disown
  wait_for "API" "curl -sf http://localhost:$API_PORT/health" 30
  ok "API up at http://localhost:$API_PORT"
fi

# --- 5. Email worker ----------------------------------------------------------

if pgrep -f "tsx src/workers/email.worker.ts" >/dev/null 2>&1; then
  warn "Worker already running, skipping"
else
  info "Starting email worker..."
  cd "$ROOT"
  nohup npx tsx src/workers/email.worker.ts >"$LOG_DIR/worker.log" 2>&1 &
  disown
  sleep 3
  if ! pgrep -f "tsx src/workers/email.worker.ts" >/dev/null 2>&1; then
    fail "worker exited immediately — see $LOG_DIR/worker.log"
  fi
  ok "Worker up"
fi

# --- 6. Frontend ---------------------------------------------------------

if port_in_use "$WEB_PORT"; then
  warn "Port $WEB_PORT already in use — assuming the frontend is already running, skipping"
else
  info "Starting frontend (port $WEB_PORT)..."
  cd "$WEB"
  nohup npm run dev >"$LOG_DIR/web.log" 2>&1 &
  disown
  cd "$ROOT"
  wait_for "frontend" "curl -sf http://localhost:$WEB_PORT" 30
  ok "Frontend up at http://localhost:$WEB_PORT"
fi

# --- Summary -----------------------------------------------------------------

echo
ok "Everything is up."
echo
echo "  API        http://localhost:$API_PORT"
echo "  Frontend   http://localhost:$WEB_PORT"
echo "  Logs       $LOG_DIR/{api,worker,web}.log"
echo
DRY_RUN_LINE=$(curl -s "http://localhost:$API_PORT/health" 2>/dev/null || echo '{}')
echo "  Health     $DRY_RUN_LINE"
echo
echo "  Stop everything with: ./down.sh"

if [ "${1:-}" = "--logs" ]; then
  echo
  info "Tailing logs (Ctrl-C stops tailing, services keep running)..."
  tail -f "$LOG_DIR/api.log" "$LOG_DIR/worker.log" "$LOG_DIR/web.log"
fi
