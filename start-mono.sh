#!/usr/bin/env bash
set -euo pipefail

echo "[start] 🚀 Starting Vecto Pilot in MONO mode..."

# Load env from mono-mode.env and .env (if present)
if [ -f mono-mode.env ]; then
  set -a && source mono-mode.env && set +a
  echo "[start] ✅ Loaded mono-mode.env"
fi
if [ -f .env ]; then
  set -a && source .env && set +a
  echo "[start] ✅ Loaded .env"
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-5000}"
export ENABLE_BACKGROUND_WORKER="${ENABLE_BACKGROUND_WORKER:-true}"

echo "[start] Environment:"
echo "  HOST=$HOST"
echo "  PORT=$PORT"
echo "  ENABLE_BACKGROUND_WORKER=$ENABLE_BACKGROUND_WORKER"
echo "  NODE_ENV=$NODE_ENV"
echo "  DATABASE_URL=${DATABASE_URL:+***configured***}"

# Kill stale processes on PORT
if command -v lsof >/dev/null 2>&1; then
  echo "[start] 🧹 Clearing port $PORT..."
  lsof -ti tcp:$PORT | xargs -r kill -9 2>/dev/null || true
  echo "[start] ✅ Port cleared"
fi

# Start gateway server
echo "[start] 🌐 Starting gateway server..."
node gateway-server.js &
SERVER_PID=$!
echo "[start] ✅ Gateway server started (PID: $SERVER_PID)"

# Start triad worker (only if enabled)
if [ "$ENABLE_BACKGROUND_WORKER" = "true" ]; then
  echo "[start] ⚡ Starting triad worker..."
  node strategy-generator.js &
  WORKER_PID=$!
  echo "[start] ✅ Triad worker started (PID: $WORKER_PID)"
else
  echo "[start] ⏸️  Background worker disabled"
  WORKER_PID=""
fi

# Readiness: wait for /ready 200
echo "[start] ⏳ Waiting for server ready..."
ATTEMPTS=30
READY=0
for i in $(seq 1 $ATTEMPTS); do
  if curl -s -m 2 "http://127.0.0.1:$PORT/ready" 2>/dev/null | grep -q '"ok":true'; then
    READY=1
    echo "[start] ✅ Server ready!"
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "[start] ❌ Readiness check failed after $ATTEMPTS attempts"
  kill $SERVER_PID 2>/dev/null || true
  [ -n "${WORKER_PID:-}" ] && kill $WORKER_PID 2>/dev/null || true
  exit 1
fi

echo "[start] 🎉 Vecto Pilot ready at http://$HOST:$PORT"
echo "[start] Server PID: $SERVER_PID"
[ -n "${WORKER_PID:-}" ] && echo "[start] Worker PID: $WORKER_PID"

# Wait for server process (worker runs independently)
wait $SERVER_PID
