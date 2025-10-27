#!/bin/bash
# Vecto Pilot - Mono Mode Startup Script
# Handles mono-mode.env gracefully and ensures proper environment loading

set -e  # Exit on error

echo "[start-mono] Starting Vecto Pilot in MONO mode..."

# Check if mono-mode.env exists
if [ -f mono-mode.env ]; then
  echo "[start-mono] Loading environment from mono-mode.env"
  # Use set -a to export all variables, source the file, then unset -a
  set -a
  source mono-mode.env
  set +a
else
  echo "[start-mono] WARNING: mono-mode.env not found, using defaults"
  # Set minimal required environment variables
  export APP_MODE=mono
  export DISABLE_SPAWN_SDK=1
  export DISABLE_SPAWN_AGENT=1
  export NODE_ENV="${NODE_ENV:-production}"
  export PORT="${PORT:-80}"  # Cloud Run expects port 80
  export API_PREFIX="${API_PREFIX:-/api}"
  export AGENT_PREFIX="${AGENT_PREFIX:-/agent}"
  export WS_PUBLIC_PATH="${WS_PUBLIC_PATH:-/agent/ws}"
  export SOCKET_IO_PATH="${SOCKET_IO_PATH:-/socket.io}"
fi

# Verify critical environment variables
echo "[start-mono] Environment check:"
echo "  APP_MODE=${APP_MODE}"
echo "  PORT=${PORT}"
echo "  NODE_ENV=${NODE_ENV}"
echo "  DATABASE_URL=${DATABASE_URL:+***configured***}"

# Start the application
echo "[start-mono] Launching gateway-server.js..."
exec node gateway-server.js
