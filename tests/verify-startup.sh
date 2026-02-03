
#!/bin/bash
set -e

echo "🔍 Startup Verification & Auto-Fix Loop"
echo "========================================"

# Function to check and kill port
check_and_kill_port() {
  local port=$1
  local service=$2
  
  if lsof -ti:$port > /dev/null 2>&1; then
    echo "⚠️  Port $port ($service) is in use - killing..."
    lsof -ti:$port | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "✅ Port $port cleared"
  else
    echo "✅ Port $port ($service) is free"
  fi
}

# Step 1: Clean all ports
echo ""
echo "📋 Step 1: Port Cleanup"
echo "----------------------"
check_and_kill_port 5000 "Gateway"
check_and_kill_port 3101 "Eidolon SDK"
check_and_kill_port 43717 "Agent"
check_and_kill_port 24678 "Vite WebSocket"
check_and_kill_port 3003 "Vite Dev"

# Step 2: Verify environment
echo ""
echo "📋 Step 2: Environment Check"
echo "----------------------------"

if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found - copying from .env.example"
  cp .env.example .env
  echo "✅ .env created"
else
  echo "✅ .env exists"
fi

# Check required env vars
required_vars=("ANTHROPIC_API_KEY" "OPENAI_API_KEY" "GEMINI_API_KEY")
missing=0

for var in "${required_vars[@]}"; do
  if grep -q "^${var}=your_" .env 2>/dev/null; then
    echo "⚠️  $var not configured (using placeholder)"
    ((missing++))
  elif grep -q "^${var}=" .env 2>/dev/null; then
    echo "✅ $var configured"
  else
    echo "❌ $var missing from .env"
    ((missing++))
  fi
done

# Step 3: Start services
echo ""
echo "📋 Step 3: Starting Services"
echo "----------------------------"

# Start gateway in background
echo "🚀 Starting gateway server..."
NODE_ENV=development VITE_PORT=3003 PLANNER_DEADLINE_MS=120000 VALIDATOR_DEADLINE_MS=60000 node gateway-server.js > /tmp/gateway.log 2>&1 &
GATEWAY_PID=$!
echo "   Gateway PID: $GATEWAY_PID"

# Wait for gateway to start
sleep 3

# Step 4: Health checks
echo ""
echo "📋 Step 4: Health Verification"
echo "------------------------------"

max_attempts=10
attempt=0

while [ $attempt -lt $max_attempts ]; do
  if curl -s http://127.0.0.1:5000/health > /dev/null 2>&1; then
    echo "✅ Gateway health check passed"
    
    # Additional endpoint checks
    echo ""
    echo "Testing endpoints..."
    curl -s http://127.0.0.1:5000/health | jq '.' || echo "   Gateway: OK (non-JSON)"
    curl -s http://127.0.0.1:43717/health | jq '.' 2>/dev/null || echo "   Agent: Not responding (expected if not started)"
    
    echo ""
    echo "🎉 Startup verification COMPLETE!"
    echo "=================================="
    echo ""
    echo "Gateway running on: http://0.0.0.0:5000"
    echo "Gateway PID: $GATEWAY_PID"
    echo ""
    echo "To view logs: tail -f /tmp/gateway.log"
    exit 0
  fi
  
  ((attempt++))
  echo "⏳ Waiting for gateway... (attempt $attempt/$max_attempts)"
  sleep 2
done

# If we get here, startup failed
echo ""
echo "❌ Gateway failed to start after $max_attempts attempts"
echo ""
echo "Last 20 lines of gateway log:"
tail -20 /tmp/gateway.log
echo ""
echo "Cleaning up..."
kill $GATEWAY_PID 2>/dev/null || true

exit 1
