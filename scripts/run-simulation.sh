#!/usr/bin/env bash
set -euo pipefail

# Minimal, deterministic simulation runner
export SIMULATE=1
export SNAPSHOT_ID="${SNAPSHOT_ID:-sim-0001}"
export CLIENT_ID="${CLIENT_ID:-client-dev}"
export LOG_FILE="${LOG_FILE:-/tmp/workflow.ndjson}"
export SIM_DELAY_MS="${SIM_DELAY_MS:-300}"

echo "📊 Running workflow simulation..."
echo "   Snapshot ID: $SNAPSHOT_ID"
echo "   Client ID:   $CLIENT_ID"
echo "   Log file:    $LOG_FILE"
echo "   Delay (ms):  $SIM_DELAY_MS"
echo ""

# Honor the deployment run command
node scripts/start-replit.js

echo ""
echo "✅ Simulation complete!"
echo ""
echo "📋 View logs:"
echo "   cat $LOG_FILE"
echo "   tail -f $LOG_FILE"
echo ""
echo "🔍 Verify workflow stages:"
echo "   jq -r '.type' $LOG_FILE | paste -sd ',' -"
