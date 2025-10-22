#!/bin/bash
# Vecto Pilot - Production Startup Script
# This starts ONLY what's needed: Agent + Gateway (which spawns SDK)

set -e

echo "================================"
echo "Vecto Pilot™ - Starting Services"
echo "================================"

# Clean slate
pkill -9 -f "node.*agent-server" 2>/dev/null || true
pkill -9 -f "node.*gateway-server" 2>/dev/null || true  
pkill -9 -f "node.*index.js" 2>/dev/null || true
sleep 2

# Start Agent (background, persistent)
echo "→ Starting Agent Server on port 43717..."
AGENT_PORT=43717 NODE_ENV=development node agent-server.js > /tmp/agent.log 2>&1 &
AGENT_PID=$!
echo "  Agent PID: $AGENT_PID"

# Wait for agent to be ready
sleep 3

# Start Gateway (foreground - this is the main process)
echo "→ Starting Gateway on port 80 (spawns SDK automatically)..."
echo ""
PORT=80 GATEWAY_PORT=80 NODE_ENV=development exec node gateway-server.js
