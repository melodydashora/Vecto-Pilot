
#!/bin/bash

# Test API Endpoints with Replit Secrets
# This script verifies that all major APIs are accessible and responding

set -e

BASE_URL="http://0.0.0.0:5000"

echo "========================================="
echo "🧪 Testing Vecto Pilot API Endpoints"
echo "========================================="
echo ""

# Health Check
echo "1️⃣ Testing Health Endpoint..."
curl -s "${BASE_URL}/health" | python3 -m json.tool || echo "❌ Health check failed"
echo ""

# Ready Check
echo "2️⃣ Testing Ready Endpoint..."
curl -s "${BASE_URL}/ready" | python3 -m json.tool || echo "❌ Ready check failed"
echo ""

# Database Diagnostic
echo "3️⃣ Testing Database Diagnostic..."
curl -s "${BASE_URL}/api/diagnostic/db-info" | python3 -m json.tool || echo "❌ DB diagnostic failed"
echo ""

# Strategy Health
echo "4️⃣ Testing Strategy Provider Health..."
curl -s "${BASE_URL}/health/strategies" | python3 -m json.tool || echo "❌ Strategy health failed"
echo ""

# Pool Stats
echo "5️⃣ Testing Database Pool Stats..."
curl -s "${BASE_URL}/health/pool-stats" | python3 -m json.tool || echo "❌ Pool stats failed"
echo ""

# Location API Test (requires GPS coordinates)
echo "6️⃣ Testing Location Resolution API..."
curl -s "${BASE_URL}/api/location/resolve?lat=32.9117167&lng=-96.9907197&device_id=test-device-001" | python3 -m json.tool || echo "❌ Location API failed"
echo ""

# Auth Health Check
echo "7️⃣ Testing Auth Endpoint Health..."
curl -s -X POST "${BASE_URL}/api/auth/health" \
  -H "Content-Type: application/json" \
  | python3 -m json.tool || echo "❌ Auth health failed"
echo ""

# Agent Health
echo "8️⃣ Testing Agent Endpoint..."
curl -s "${BASE_URL}/agent/health" | python3 -m json.tool || echo "❌ Agent health failed"
echo ""

echo ""
echo "========================================="
echo "✅ API Endpoint Testing Complete"
echo "========================================="
