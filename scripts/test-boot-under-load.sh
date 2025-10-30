#!/usr/bin/env bash
# test-boot-under-load.sh
# Validates that health endpoints stay green during heavy boot initialization
# This simulates Cloud Run's readiness probe behavior during app startup

set -e

PORT="${PORT:-5000}"
BASE_URL="http://127.0.0.1:${PORT}"
PROBE_COUNT=100
PROBE_INTERVAL=0.2

echo "═══════════════════════════════════════════════════════════════════"
echo "  Boot Load Test - Health Endpoints Under Load"
echo "═══════════════════════════════════════════════════════════════════"
echo "Testing: ${BASE_URL}"
echo "Probes: ${PROBE_COUNT} requests every ${PROBE_INTERVAL}s"
echo ""
echo "This test simulates Cloud Run health checks during boot initialization."
echo "All probes should return 200 OK, even while heavy init tasks run."
echo ""

# Results tracking
success_count=0
fail_count=0
timeout_count=0

declare -a response_codes

echo "Starting probes..."
echo ""

# Spam health endpoint while app boots
for i in $(seq 1 $PROBE_COUNT); do
  # Use timeout command to catch hangs
  response=$(timeout 2 curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/" 2>/dev/null || echo "TIMEOUT")
  
  response_codes+=("$response")
  
  if [ "$response" = "200" ]; then
    ((success_count++))
    echo -n "."
  elif [ "$response" = "TIMEOUT" ]; then
    ((timeout_count++))
    echo -n "T"
  else
    ((fail_count++))
    echo -n "X"
  fi
  
  # Small delay between probes
  sleep "$PROBE_INTERVAL"
done

echo ""
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "Results:"
echo "  ✓ Success (200): ${success_count}/${PROBE_COUNT}"
echo "  ✗ Failed (!200): ${fail_count}/${PROBE_COUNT}"
echo "  ⏱  Timeout:      ${timeout_count}/${PROBE_COUNT}"
echo ""

# Calculate success rate
success_rate=$((success_count * 100 / PROBE_COUNT))
echo "Success rate: ${success_rate}%"
echo ""

# Show failure details if any
if [ $fail_count -gt 0 ] || [ $timeout_count -gt 0 ]; then
  echo "Failed/Timeout responses:"
  for i in "${!response_codes[@]}"; do
    code="${response_codes[$i]}"
    if [ "$code" != "200" ]; then
      echo "  Probe #$((i+1)): $code"
    fi
  done
  echo ""
fi

echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Pass criteria: 95% success rate (allow a few failures due to timing)
if [ $success_rate -ge 95 ]; then
  echo "✅ PASSED - Server maintained health during boot load"
  echo "   ${success_count}/${PROBE_COUNT} probes succeeded (${success_rate}%)"
  exit 0
else
  echo "❌ FAILED - Server struggled under boot load"
  echo "   Only ${success_count}/${PROBE_COUNT} probes succeeded (${success_rate}%)"
  echo ""
  echo "This indicates event loop starvation during boot."
  echo "Check for blocking operations before server.listen()."
  exit 1
fi
