#!/bin/bash
# Vecto Pilot - Mono Mode Startup Script (Cloud Run optimized)

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
  export PORT="${PORT:-5000}"   # Replit maps internal 5000 → external 80
  export DISABLE_SPAWN_VITE=1   # Don't spawn Vite in production
  export API_PREFIX="${API_PREFIX:-/api}"
  export AGENT_PREFIX="${AGENT_PREFIX:-/agent}"
  export WS_PUBLIC_PATH="${WS_PUBLIC_PATH:-/agent/ws}"
  export SOCKET_IO_PATH="${SOCKET_IO_PATH:-/socket.io}"
fi

# Force Neon database connection (not Replit's local database)
export DATABASE_URL="postgresql://neondb_owner:npg_z0Nf6BrIACao@ep-patient-rice-afbgoryq-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
export PG_USE_SHARED_POOL="true"

# Force internal port 5000 (Cloud Run maps to external 80)
export PORT="${PORT:-5000}"
echo "[start-mono] Forcing internal port 5000 → external 80"
echo "[start-mono] Using Neon PostgreSQL 17.5 (not Replit's 16.9)"

# Environment check
echo "[start-mono] Environment check:"
echo "  APP_MODE=${APP_MODE}"
echo "  PORT=${PORT}"
echo "  NODE_ENV=${NODE_ENV}"
echo "  DATABASE_URL=${DATABASE_URL:+***configured***}"

# Check if frontend is built (skip CI if already built)
if [ -d "client/dist" ]; then
  echo "[start-mono] ✅ Frontend already built (client/dist exists)"
else
  echo "[start-mono] ⚠️  No client/dist found"
  if [ -d "client" ] && [ -f "client/package.json" ]; then
    echo "[start-mono] Building frontend..."
    # Use npm install instead of ci since there's no lock file
    cd client
    npm install --omit=dev
    npm run build
    cd ..
    echo "[start-mono] ✅ Frontend build complete"
  else
    echo "[start-mono] ⚠️  No client directory, skipping frontend build"
  fi
fi

# Launch server
echo "[start-mono] Launching gateway-server.js on port ${PORT}..."
exec node gateway-server.js
