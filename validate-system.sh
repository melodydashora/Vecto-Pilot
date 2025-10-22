#!/bin/bash
# Vecto Pilot - System Validation Script
# Run this AFTER clicking the Run button to validate all 3 servers are working

echo "🔍 Vecto Pilot System Validation"
echo "================================="
echo ""

# Wait for systems to boot
echo "⏳ Waiting 10 seconds for all servers to boot..."
sleep 10

# Check if processes are running
echo ""
echo "1️⃣ Checking Running Processes..."
NODE_PROCS=$(ps aux | grep "[n]ode" | grep -E "gateway|index|agent" | wc -l)
if [ "$NODE_PROCS" -ge 3 ]; then
  echo "  ✅ Found $NODE_PROCS node processes (expected 3)"
  ps aux | grep "[n]ode" | grep -E "gateway|index|agent" | head -5
else
  echo "  ❌ Only found $NODE_PROCS node processes (expected 3)"
  echo "  Showing all node processes:"
  ps aux | grep "[n]ode" | head -10
fi

# Check if ports are listening
echo ""
echo "2️⃣ Checking Port Status..."
PORT_80=$(lsof -i:80 2>&1 | grep LISTEN | wc -l)
PORT_3101=$(lsof -i:3101 2>&1 | grep LISTEN | wc -l)
PORT_43717=$(lsof -i:43717 2>&1 | grep LISTEN | wc -l)

if [ "$PORT_80" -ge 1 ]; then
  echo "  ✅ Port 80 (Gateway) is listening"
else
  echo "  ❌ Port 80 (Gateway) is NOT listening"
fi

if [ "$PORT_3101" -ge 1 ]; then
  echo "  ✅ Port 3101 (Eidolon SDK) is listening"
else
  echo "  ❌ Port 3101 (Eidolon SDK) is NOT listening"
fi

if [ "$PORT_43717" -ge 1 ]; then
  echo "  ✅ Port 43717 (Agent) is listening"
else
  echo "  ❌ Port 43717 (Agent) is NOT listening"
fi

# Test health endpoints
echo ""
echo "3️⃣ Testing Health Endpoints..."

# Gateway health
GATEWAY=$(curl -s http://localhost:80/api/health --max-time 3 2>&1)
if echo "$GATEWAY" | grep -q '"ok":true'; then
  echo "  ✅ Gateway health check passed"
else
  echo "  ❌ Gateway health check failed: $GATEWAY"
fi

# Eidolon SDK health
SDK=$(curl -s http://localhost:3101/health --max-time 3 2>&1)
if echo "$SDK" | grep -q '"ok":true'; then
  echo "  ✅ Eidolon SDK health check passed"
else
  echo "  ❌ Eidolon SDK health check failed: $SDK"
fi

# Agent health
AGENT=$(curl -s http://localhost:43717/agent/health --max-time 3 2>&1)
if echo "$AGENT" | grep -q '"status":"healthy"'; then
  echo "  ✅ Agent health check passed"
else
  echo "  ❌ Agent health check failed: $AGENT"
fi

# Test ML health dashboard
echo ""
echo "4️⃣ Testing ML Infrastructure..."
ML_HEALTH=$(curl -s http://localhost:80/api/ml/health --max-time 5 2>&1)
if echo "$ML_HEALTH" | grep -q 'overall_health_score'; then
  echo "  ✅ ML health dashboard responding"
  echo "$ML_HEALTH" | head -20
else
  echo "  ❌ ML health dashboard failed: $ML_HEALTH"
fi

# Summary
echo ""
echo "================================="
echo "📊 VALIDATION SUMMARY"
echo "================================="
TOTAL=0
PASSED=0

if [ "$NODE_PROCS" -ge 3 ]; then ((PASSED++)); fi
((TOTAL++))

if [ "$PORT_80" -ge 1 ]; then ((PASSED++)); fi
((TOTAL++))

if [ "$PORT_3101" -ge 1 ]; then ((PASSED++)); fi
((TOTAL++))

if [ "$PORT_43717" -ge 1 ]; then ((PASSED++)); fi
((TOTAL++))

if echo "$GATEWAY" | grep -q '"ok":true'; then ((PASSED++)); fi
((TOTAL++))

if echo "$SDK" | grep -q '"ok":true'; then ((PASSED++)); fi
((TOTAL++))

if echo "$AGENT" | grep -q '"status":"healthy"'; then ((PASSED++)); fi
((TOTAL++))

if echo "$ML_HEALTH" | grep -q 'overall_health_score'; then ((PASSED++)); fi
((TOTAL++))

echo "Tests Passed: $PASSED/$TOTAL"

if [ "$PASSED" -eq "$TOTAL" ]; then
  echo "🎉 ALL SYSTEMS OPERATIONAL!"
  echo ""
  echo "Preview URL: https://${REPL_SLUG}.${REPL_OWNER}.repl.co"
else
  echo "⚠️  Some systems failed - check details above"
fi
