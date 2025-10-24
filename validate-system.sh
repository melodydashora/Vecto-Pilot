#!/bin/bash
# Vecto Pilot - System Validation Script (MONO Mode)
# Run this AFTER clicking the Run button to validate system is working
#
# MONO MODE: All services (Gateway/SDK/Agent) run embedded in single process on port 5000

echo "🔍 Vecto Pilot™ System Validation (MONO Mode)"
echo "=============================================="
echo ""

# Wait for systems to boot
echo "⏳ Waiting 8 seconds for gateway to boot..."
sleep 8

# Detect mode
MODE="${APP_MODE:-mono}"
GATEWAY_PORT="${PORT:-5000}"

echo "📋 Configuration:"
echo "   Mode: $MODE"
echo "   Gateway Port: $GATEWAY_PORT"
echo ""

# Check if processes are running
echo "1️⃣ Checking Running Processes..."
if [ "$MODE" = "mono" ]; then
  # In MONO mode, we expect 1 gateway process (+ optionally Vite)
  GATEWAY_PROC=$(ps aux | grep "[n]ode.*gateway-server.js" | wc -l)
  VITE_PROC=$(ps aux | grep "[v]ite dev" | wc -l)
  
  if [ "$GATEWAY_PROC" -ge 1 ]; then
    echo "  ✅ Gateway process running (MONO mode - SDK & Agent embedded)"
    ps aux | grep "[n]ode.*gateway-server.js"
  else
    echo "  ❌ Gateway process NOT found"
    echo "  Showing all node processes:"
    ps aux | grep "[n]ode" | grep -v "typescript\|tsserver" | head -10
  fi
  
  if [ "$VITE_PROC" -ge 1 ]; then
    echo "  ✅ Vite dev server running (frontend)"
  else
    echo "  ⚠️  Vite dev server not running (frontend may be static)"
  fi
else
  # In SPLIT mode, we expect 3 separate processes
  NODE_PROCS=$(ps aux | grep "[n]ode" | grep -E "gateway|index|agent" | wc -l)
  if [ "$NODE_PROCS" -ge 3 ]; then
    echo "  ✅ Found $NODE_PROCS node processes (SPLIT mode)"
    ps aux | grep "[n]ode" | grep -E "gateway|index|agent" | head -5
  else
    echo "  ❌ Only found $NODE_PROCS node processes (expected 3 for SPLIT mode)"
  fi
fi

# Check if ports are listening
echo ""
echo "2️⃣ Checking Port Status..."

if [ "$MODE" = "mono" ]; then
  # MONO mode: Only check gateway port (5000 by default)
  PORT_GATEWAY=$(lsof -i:${GATEWAY_PORT} 2>&1 | grep LISTEN | wc -l)
  
  if [ "$PORT_GATEWAY" -ge 1 ]; then
    echo "  ✅ Port $GATEWAY_PORT (Gateway with embedded SDK/Agent) is listening"
  else
    echo "  ❌ Port $GATEWAY_PORT (Gateway) is NOT listening"
    echo "     Trying to find what's listening..."
    lsof -i -P -n | grep LISTEN | grep -E ":(5000|3000|8080|80)" | head -5 || echo "     No common ports listening"
  fi
  
  # Optional: Check Vite port
  PORT_VITE=$(lsof -i:5173 2>&1 | grep LISTEN | wc -l)
  if [ "$PORT_VITE" -ge 1 ]; then
    echo "  ✅ Port 5173 (Vite dev server) is listening"
  else
    echo "  ⚠️  Port 5173 (Vite) is NOT listening (may use static build)"
  fi
else
  # SPLIT mode: Check all 3 ports
  PORT_80=$(lsof -i:80 2>&1 | grep LISTEN | wc -l)
  PORT_3101=$(lsof -i:3101 2>&1 | grep LISTEN | wc -l)
  PORT_43717=$(lsof -i:43717 2>&1 | grep LISTEN | wc -l)
  
  [ "$PORT_80" -ge 1 ] && echo "  ✅ Port 80 (Gateway)" || echo "  ❌ Port 80 (Gateway) NOT listening"
  [ "$PORT_3101" -ge 1 ] && echo "  ✅ Port 3101 (SDK)" || echo "  ❌ Port 3101 (SDK) NOT listening"
  [ "$PORT_43717" -ge 1 ] && echo "  ✅ Port 43717 (Agent)" || echo "  ❌ Port 43717 (Agent) NOT listening"
fi

# Test health endpoints
echo ""
echo "3️⃣ Testing Health Endpoints..."

# Gateway health (MONO: all-in-one, SPLIT: just gateway)
GATEWAY=$(curl -s http://localhost:${GATEWAY_PORT}/api/health --max-time 5 2>&1)
if echo "$GATEWAY" | grep -q '"ok":true'; then
  echo "  ✅ Gateway health check passed"
  # Show uptime and memory
  UPTIME=$(echo "$GATEWAY" | grep -o '"uptime":[0-9.]*' | grep -o '[0-9.]*' | head -1)
  PID=$(echo "$GATEWAY" | grep -o '"pid":[0-9]*' | grep -o '[0-9]*')
  if [ -n "$UPTIME" ]; then
    UPTIME_SEC=$(printf "%.0f" "$UPTIME")
    echo "     Uptime: ${UPTIME_SEC}s (PID: $PID)"
  fi
else
  echo "  ❌ Gateway health check failed"
  echo "     Response: $GATEWAY" | head -c 200
fi

# In SPLIT mode, also check SDK and Agent separately
if [ "$MODE" = "split" ]; then
  SDK=$(curl -s http://localhost:3101/health --max-time 3 2>&1)
  if echo "$SDK" | grep -q '"ok":true'; then
    echo "  ✅ SDK health check passed"
  else
    echo "  ❌ SDK health check failed"
  fi
  
  AGENT=$(curl -s http://localhost:43717/agent/health --max-time 3 2>&1)
  if echo "$AGENT" | grep -q '"status":"healthy"'; then
    echo "  ✅ Agent health check passed"
  else
    echo "  ❌ Agent health check failed"
  fi
else
  echo "  ℹ️  MONO mode: SDK & Agent embedded in gateway (no separate checks needed)"
fi

# Test database connectivity
echo ""
echo "4️⃣ Testing Database Connection..."
DB_TEST=$(curl -s http://localhost:${GATEWAY_PORT}/api/health --max-time 3 2>&1)
if echo "$DB_TEST" | grep -q '"ok":true'; then
  echo "  ✅ Database accessible via API"
else
  echo "  ❌ Database check failed"
fi

# Summary
echo ""
echo "=============================================="
echo "📊 VALIDATION SUMMARY"
echo "=============================================="
TOTAL=0
PASSED=0

# Process check
if [ "$MODE" = "mono" ]; then
  if [ "$GATEWAY_PROC" -ge 1 ]; then ((PASSED++)); fi
else
  if [ "$NODE_PROCS" -ge 3 ]; then ((PASSED++)); fi
fi
((TOTAL++))

# Port check
if [ "$MODE" = "mono" ]; then
  if [ "$PORT_GATEWAY" -ge 1 ]; then ((PASSED++)); fi
else
  if [ "$PORT_80" -ge 1 ] && [ "$PORT_3101" -ge 1 ] && [ "$PORT_43717" -ge 1 ]; then ((PASSED++)); fi
fi
((TOTAL++))

# Health check
if echo "$GATEWAY" | grep -q '"ok":true'; then ((PASSED++)); fi
((TOTAL++))

# Additional checks for SPLIT mode
if [ "$MODE" = "split" ]; then
  if echo "$SDK" | grep -q '"ok":true'; then ((PASSED++)); fi
  ((TOTAL++))
  
  if echo "$AGENT" | grep -q '"status":"healthy"'; then ((PASSED++)); fi
  ((TOTAL++))
fi

echo "Tests Passed: $PASSED/$TOTAL"
echo ""

if [ "$PASSED" -eq "$TOTAL" ]; then
  echo "🎉 ALL SYSTEMS OPERATIONAL!"
  echo ""
  echo "✅ Gateway: http://localhost:${GATEWAY_PORT}"
  echo "✅ Health: http://localhost:${GATEWAY_PORT}/api/health"
  if [ -n "$REPL_SLUG" ] && [ -n "$REPL_OWNER" ]; then
    echo "✅ Public URL: https://${REPL_SLUG}.${REPL_OWNER}.repl.co"
  fi
  echo ""
  echo "🚀 System ready for use!"
else
  echo "⚠️  Some systems failed - check details above"
  echo ""
  echo "Common issues:"
  echo "  - Workflow not started: Click 'Run App' button"
  echo "  - Wrong mode: Check APP_MODE env var (should be 'mono')"
  echo "  - Port conflict: Check if port $GATEWAY_PORT is already in use"
fi

exit 0
