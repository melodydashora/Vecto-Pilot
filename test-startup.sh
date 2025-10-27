#!/bin/bash
# Vecto Pilot - Mono Mode Startup Script (Replit-optimized)

set -e  # Exit on error

echo "[start-mono] Starting Vecto Pilot in MONO mode..."

# Load mono-mode.env if present
if [ -f mono-mode.env ]; then
  echo "[start-mono] Loading environment from mono-mode.env"
  set -a
  source mono-mode.env
  set +a
else
  echo "[start-mono] WARNING: mono-mode.env not found, using defaults"
  export APP_MODE=mono
  export DISABLE_SPAWN_SDK=1
  export DISABLE_SPAWN_AGENT=1
  export NODE_ENV="${NODE_ENV:-production}"
  export PORT="${PORT:-5000}"   # ✅ internal port 5000, auto-mapped → external :80
  export API_PREFIX="${API_PREFIX:-/api}"
  export AGENT_PREFIX="${AGENT_PREFIX:-/agent}"
  export WS_PUBLIC_PATH="${WS_PUBLIC_PATH:-/agent/ws}"
  export SOCKET_IO_PATH="${SOCKET_IO_PATH:-/socket.io}"
fi

# Environment check
echo "[start-mono] Environment check:"
echo "  APP_MODE=${APP_MODE}"
echo "  PORT=${PORT}"
echo "  NODE_ENV=${NODE_ENV}"
echo "  DATABASE_URL=${DATABASE_URL:+***configured***}"

# Build frontend (if using Vite)
if [ -d "client" ]; then
  echo "[start-mono] Building frontend..."
  npm ci --prefix client
  npm run build --prefix client
fi

# Launch server
echo "[start-mono] Launching gateway-server.js..."
exec node gateway-server.js