
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
#   1. Loads environment variables from mono-mode.env and .env
#   2. Optionally clears port 5000 if conflicts exist
#   3. Starts the gateway server (which spawns SDK/Agent as needed)
#   4. Optionally starts the background worker for strategy generation
#
# PRODUCTION vs DEVELOPMENT:
#   - Production: Uses npm run start:replit (builds client first)
#   - Development: Uses node gateway-server.js directly (assumes client built)
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
if [ -f mono-mode.env ]; then
  set -a && source mono-mode.env && set +a
  echo "[start] ✅ Loaded mono-mode.env"
fi

if [ -f .env ]; then
  set -a && source .env && set +a
  echo "[start] ✅ Loaded .env"
fi

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
  exec npm run start:replit
fi
