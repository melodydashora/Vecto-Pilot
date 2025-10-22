#!/bin/bash
# Vecto Pilot - Complete Verification Test Suite
# Run this after clicking the Run button

echo "======================================================================"
echo "  VECTO PILOT - DEFINITION OF DONE VERIFICATION"
echo "======================================================================"
echo ""

sleep 2

echo "TEST 1/10: Port Stability Check"
echo "----------------------------------------------------------------------"
lsof -i -P -n | grep LISTEN | grep -E ':(80|3101|43717|5173)'
echo ""

echo "TEST 2/10: Gateway Health (Pre-test)"
echo "----------------------------------------------------------------------"
curl -i http://localhost/healthz
echo ""

echo "TEST 3/10: Comprehensive Status with Memory"
echo "----------------------------------------------------------------------"
curl -s http://localhost/status | python3 -m json.tool || curl -i http://localhost/status
echo ""

echo "TEST 4/10: Location API via Gateway"
echo "----------------------------------------------------------------------"
curl -i "http://localhost/api/location/resolve?lat=33.1286&lng=-96.8756"
echo ""

echo "TEST 5/10: Location API Direct to SDK"
echo "----------------------------------------------------------------------"
curl -i "http://127.0.0.1:3101/location/resolve?lat=33.1286&lng=-96.8756"
echo ""

echo "TEST 6/10: Snapshot Creation (Proper Body)"
echo "----------------------------------------------------------------------"
curl -i -X POST "http://localhost/api/location/snapshot" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 33.1286,
    "lng": -96.8756,
    "context": {
      "city": "Frisco",
      "state": "TX",
      "timezone": "America/Chicago",
      "formattedAddress": "Frisco, TX",
      "accuracy": 10
    }
  }'
echo ""

echo "TEST 7/10: Memory Diagnostics"
echo "----------------------------------------------------------------------"
curl -i http://localhost/diagnostics/memory
echo ""

echo "TEST 8/10: Save User Preference"
echo "----------------------------------------------------------------------"
curl -i -X POST http://localhost/diagnostics/prefs \
  -H "Content-Type: application/json" \
  -d '{"key":"driver_mode","value":"tactical"}'
echo ""

echo "TEST 9/10: Agent Health via Gateway"
echo "----------------------------------------------------------------------"
curl -i http://localhost/agent/healthz
echo ""

echo "TEST 10/10: Error Boundary - Unknown API Route"
echo "----------------------------------------------------------------------"
curl -i http://localhost/api/nonexistent
echo ""

echo "======================================================================"
echo "  VERIFICATION COMPLETE"
echo "======================================================================"
echo ""
echo "Expected Results:"
echo "  ✓ All 4 ports listening (80, 3101, 43717, 5173)"
echo "  ✓ /healthz returns 200 JSON"
echo "  ✓ /status returns 200 (all services healthy)"
echo "  ✓ Location resolve returns Frisco, TX data"
echo "  ✓ Snapshot returns 201 with artifactId"
echo "  ✓ /diagnostics/memory returns JSON with recent paths"
echo "  ✓ Preference save returns 200 confirmation"
echo "  ✓ Agent health accessible"
echo "  ✓ Unknown API route returns 404 JSON (not HTML)"
echo ""
