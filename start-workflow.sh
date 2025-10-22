#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

echo "[bootstrap] Starting SDK on 3101"
NODE_ENV=development node "$ROOT/index.js" > "$LOG_DIR/sdk.log" 2>&1 &
SDK_PID=$!

echo "[bootstrap] Starting Agent on 43717"
AGENT_PORT=43717 node "$ROOT/agent-server.js" > "$LOG_DIR/agent.log" 2>&1 &
AGENT_PID=$!

echo "[bootstrap] Waiting 5s for services to initialize..."
sleep 5

echo "[bootstrap] Checking ports..."
for PORT in 3101 43717; do
  if lsof -i :"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[bootstrap] ✓ Port $PORT is listening"
  else
    echo "[bootstrap] WARNING: Port $PORT may not be listening yet"
  fi
done

echo "[bootstrap] Starting Gateway on 80 (foreground)"
echo "[bootstrap] SDK PID: $SDK_PID, Agent PID: $AGENT_PID"
echo "[bootstrap] Logs: $LOG_DIR/sdk.log, $LOG_DIR/agent.log"
PORT=80 NODE_ENV=development exec node "$ROOT/gateway-server.js"
