#!/bin/bash
# Vecto Pilot - Clean Startup Script
# Ensures only the gateway starts (which then spawns the SDK)

echo "🧹 Cleaning up any existing processes..."
killall -9 node 2>/dev/null || true
sleep 3

echo "🔍 Verifying all ports are free..."
for port in 80 3101 3102 24700; do
  lsof -ti:$port | xargs kill -9 2>/dev/null || true
done
sleep 2

echo "🚀 Starting Vecto Pilot Gateway (which will spawn SDK)..."
cd /home/runner/workspace

# Only start gateway - it will spawn the SDK automatically
exec node gateway-server.js
