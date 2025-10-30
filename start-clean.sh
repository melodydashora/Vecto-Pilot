#!/usr/bin/env bash
# ZOMBIE KILLER - Ensures clean restart
# Kills leftover node processes before starting fresh

set -euo pipefail

echo "[clean] Killing zombie processes..."

# Kill any leftover gateway/server processes
pkill -f "node gateway-server.js" || true
pkill -f "node dist" || true
pkill -f "tsx server" || true

# Clean cache artifacts
rm -rf .cache || true

echo "[clean] Clean complete, starting app..."
npm run start:replit
