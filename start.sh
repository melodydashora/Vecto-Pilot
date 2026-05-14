#!/usr/bin/env bash
# =============================================================================
# Vecto Pilot - Unified Startup Script
# =============================================================================
# This is the canonical entry point for starting the application.
# 
# USAGE:
#   ./start.sh              # Start in production mode
#   ./start.sh dev          # Start in development mode
#   ./start.sh clean        # Clean ports and start fresh
#
# WHAT IT DOES:
#   1. Loads environment variables from .env.local and .env
#   2. Optionally clears port 5000 if conflicts exist
#   3. Starts the gateway server (which spawns SDK/Agent as needed)
#   4. Optionally starts the background worker for strategy generation
#
# PRODUCTION vs DEVELOPMENT:
#   - Both modes invoke `node gateway-server.js` directly (canonical entrypoint
#     per the 2026-05-13 startup unification pass).
#   - The only mode difference is the NODE_ENV export, which Vite/framework code
#     still reads for build-mode optimization. App code reads APP_RUNTIME.
#   - Client build is assumed present in client/dist/. Run `npm run build:client`
#     first if missing (or invoke via .replit:run which chains dev-prerun.sh).
#
# =============================================================================

set -euo pipefail

MODE="${1:-prod}"
PORT="${PORT:-5000}"
HOST="${HOST:-0.0.0.0}"

echo "[start] 🚀 Vecto Pilot Startup"
echo "[start] Mode: $MODE"
echo "[start] PORT: $PORT, HOST: $HOST"

# Load environment files
if [ -f .env_override ]; then
  set -a && source .env_override && set +a
  echo "[start] ✅ Loaded .env_override"
fi

if [ -f .env.local ]; then
  set -a && source .env.local && set +a
  echo "[start] ✅ Loaded .env.local"
fi

if [ -f .env ]; then
  set -a && source .env && set +a
  echo "[start] ✅ Loaded .env"
fi

# GCP credential reconstruction is handled by load-env.js:reconstructGcpCredentials()
# which runs inside gateway-server.js loadEnvironment() — no need to duplicate here

# Clean mode: kill processes on target port
if [ "$MODE" = "clean" ]; then
  echo "[start] 🧹 Cleaning port $PORT..."
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:$PORT | xargs -r kill -9 2>/dev/null || true
    echo "[start] ✅ Port cleared"
  fi
fi

# Start the application
if [ "$MODE" = "dev" ] || [ "$MODE" = "clean" ]; then
  echo "[start] 🌐 Starting in development mode..."
  export NODE_ENV=development
  exec node gateway-server.js
else
  echo "[start] 🌐 Starting in production mode (with client build)..."
  export NODE_ENV=production
  exec node gateway-server.js
fi