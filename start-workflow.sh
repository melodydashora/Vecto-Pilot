#!/bin/bash
# Vecto Pilot - Controlled Workflow Startup
# This script starts all services in the correct order for testing

set -e  # Exit on any error

echo "=========================================="
echo "Vecto Pilot - Workflow Startup"
echo "=========================================="
echo ""

# Step 1: Clean environment
echo "Step 1/3: Cleaning environment..."
killall -9 node 2>/dev/null || true
sleep 2

# Verify ports are free
for port in 80 3101 24700 43717; do
  if lsof -ti:$port >/dev/null 2>&1; then
    echo "ERROR: Port $port still in use!"
    lsof -i:$port
    exit 1
  fi
done
echo "✅ All ports clear"
echo ""

# Step 2: Start Agent Server (must be first)
echo "Step 2/3: Starting Agent Server on port 43717..."
cd /home/runner/workspace
node agent-server.js > /tmp/workflow-agent.log 2>&1 &
AGENT_PID=$!
sleep 3

# Verify agent is running
if curl -s http://127.0.0.1:43717/agent/health >/dev/null 2>&1; then
  echo "✅ Agent Server healthy (PID: $AGENT_PID)"
else
  echo "❌ Agent Server failed to start"
  cat /tmp/workflow-agent.log
  exit 1
fi
echo ""

# Step 3: Start Gateway (which spawns SDK)
echo "Step 3/3: Starting Gateway on port 80..."
PORT=80 NODE_ENV=development node gateway-server.js > /tmp/workflow-gateway.log 2>&1 &
GATEWAY_PID=$!

# Wait for startup
echo "Waiting for services to initialize..."
for i in {1..30}; do
  sleep 1
  echo -n "."
  
  # Check if gateway is responding
  if curl -s http://localhost:80/health >/dev/null 2>&1; then
    echo ""
    echo "✅ Gateway healthy (PID: $GATEWAY_PID)"
    echo ""
    echo "=========================================="
    echo "Workflow Started Successfully!"
    echo "=========================================="
    echo "Agent:   http://127.0.0.1:43717/agent/health"
    echo "Gateway: http://localhost:80"
    echo "ML Health: http://localhost:80/api/ml/health"
    echo ""
    echo "Process IDs:"
    echo "  Agent:   $AGENT_PID"
    echo "  Gateway: $GATEWAY_PID"
    echo ""
    echo "Logs:"
    echo "  Agent:   tail -f /tmp/workflow-agent.log"
    echo "  Gateway: tail -f /tmp/workflow-gateway.log"
    echo ""
    exit 0
  fi
done

echo ""
echo "❌ Gateway did not become healthy in time"
echo "Last 20 lines of gateway log:"
tail -20 /tmp/workflow-gateway.log
exit 1
