#!/usr/bin/env bash
# ZOMBIE KILLER - Ensures clean restart with port reliability
# Kills leftover processes and frees port before starting fresh

set -euo pipefail

PORT=${PORT:-5000}
HOST=${HOST:-0.0.0.0}

echo "[clean] 🧹 Killing zombie processes on port $PORT..."

# Kill any process using the target port
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

# Kill any leftover gateway/server processes
pkill -f "node gateway-server.js" || true
pkill -f "node dist" || true
pkill -f "tsx server" || true

# Clean cache artifacts
rm -rf .cache || true

echo "[clean] ✅ Port $PORT freed, processes killed"
echo "[clean] 🚀 Starting app on $HOST:$PORT..."
npm run start:replit
