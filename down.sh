#!/usr/bin/env bash
#
# Stops the app processes started by up.sh: backend API, email worker, and
# the Next.js frontend.
#
# Postgres and Redis are left running by default — they're shared background
# services, not part of "the app" — pass --all to stop those too.
#
# Usage:
#   ./down.sh          stop API, worker, frontend
#   ./down.sh --all     also stop Postgres and Redis (brew services)

set -uo pipefail

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
info()  { color "34" "==> $1"; }
ok()    { color "32" "✓ $1"; }
warn()  { color "33" "! $1"; }

stop_pattern() {
  local desc="$1" pattern="$2"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    pkill -f "$pattern" 2>/dev/null
    sleep 1
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      sleep 2
      pkill -9 -f "$pattern" 2>/dev/null || true
    fi
    ok "$desc stopped"
  else
    warn "$desc was not running"
  fi
}

info "Stopping app processes..."
stop_pattern "Backend API"   "tsx src/server.ts"
stop_pattern "Email worker"  "tsx src/workers/email.worker.ts"
stop_pattern "Frontend"      "next dev -p 3001"

if [ "${1:-}" = "--all" ]; then
  info "Stopping Postgres and Redis (brew services)..."
  if command -v brew >/dev/null 2>&1; then
    brew services stop postgresql@14 >/dev/null 2>&1 || brew services stop postgresql >/dev/null 2>&1 || true
    brew services stop redis >/dev/null 2>&1 || true
    ok "Postgres and Redis stopped"
  else
    warn "brew not found — stop Postgres/Redis yourself if needed"
  fi
else
  echo
  warn "Postgres and Redis left running (shared background services)."
  echo "     Stop those too with: ./down.sh --all"
fi

echo
ok "Done."
