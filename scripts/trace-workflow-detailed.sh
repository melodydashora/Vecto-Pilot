#!/bin/bash

# Detailed Workflow Trace
# Shows every API call, DB operation, and data flow from GPS to UI

OUTPUT="logs/workflow-detailed-trace.log"
CORRELATION_ID=""

mkdir -p logs
> "$OUTPUT"

echo "========================================" | tee -a "$OUTPUT"
echo "DETAILED WORKFLOW TRACE" | tee -a "$OUTPUT"
echo "Started: $(date)" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Simulate GPS coordinates (Frisco, TX - same as last test)
LAT=33.12855399613802
LNG=-96.87550973624359
USER_ID="97b62815-2fbd-4f64-9338-7744bb62ae7c"

echo "📍 STEP 1: GPS COORDINATES" | tee -a "$OUTPUT"
echo "   Latitude: $LAT" | tee -a "$OUTPUT"
echo "   Longitude: $LNG" | tee -a "$OUTPUT"
echo "   User ID: $USER_ID" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Trigger the workflow
echo "🚀 STEP 2: POST /api/blocks (Triggering Workflow)" | tee -a "$OUTPUT"
echo "   Request Body: {lat: $LAT, lng: $LNG}" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

RESPONSE=$(curl -s -X POST http://localhost:5000/api/blocks \
  -H "Content-Type: application/json" \
  -d "{\"lat\":$LAT,\"lng\":$LNG,\"userId\":\"$USER_ID\"}" \
  2>&1)

# Extract correlation ID from response
CORRELATION_ID=$(echo "$RESPONSE" | jq -r '.correlationId // empty' 2>/dev/null)

if [ -z "$CORRELATION_ID" ]; then
  echo "❌ Failed to get correlation ID. Response:" | tee -a "$OUTPUT"
  echo "$RESPONSE" | tee -a "$OUTPUT"
  exit 1
fi

echo "✅ Correlation ID: $CORRELATION_ID" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Wait for workflow to complete and capture logs
echo "⏳ Monitoring workflow execution..." | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

sleep 5

# Find the latest workflow log
LATEST_LOG=$(ls -t /tmp/logs/Eidolon_Main_*.log 2>/dev/null | head -1)

if [ -z "$LATEST_LOG" ]; then
  echo "❌ No workflow logs found" | tee -a "$OUTPUT"
  exit 1
fi

# Extract workflow details
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "WORKFLOW EXECUTION TRACE" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Extract correlation-specific logs
grep "\[$CORRELATION_ID\]" "$LATEST_LOG" | while IFS= read -r line; do
  echo "$line" | tee -a "$OUTPUT"
done

echo "" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "DATABASE OPERATIONS TRACE" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Extract DB operations
grep -E "DB (Write|Read|Query)|💾|📖" "$LATEST_LOG" | grep "\[$CORRELATION_ID\]" | while IFS= read -r line; do
  echo "$line" | tee -a "$OUTPUT"
done

echo "" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "API CALLS TRACE" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Extract API calls
grep -E "Geocoding|Places|Routes|🗺️|🔍|📏" "$LATEST_LOG" | grep "\[$CORRELATION_ID\]" | while IFS= read -r line; do
  echo "$line" | tee -a "$OUTPUT"
done

echo "" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "TRIAD PIPELINE TRACE" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Extract Triad operations
grep -E "TRIAD|Claude|GPT-5|Gemini" "$LATEST_LOG" | grep "\[$CORRELATION_ID\]" | while IFS= read -r line; do
  echo "$line" | tee -a "$OUTPUT"
done

echo "" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "FINAL RESPONSE" | tee -a "$OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

echo "$RESPONSE" | jq '.' 2>/dev/null | tee -a "$OUTPUT"

echo "" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"
echo "TRACE COMPLETE" | tee -a "$OUTPUT"
echo "Ended: $(date)" | tee -a "$OUTPUT"
echo "Output: $OUTPUT" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"

# Show summary
echo "" | tee -a "$OUTPUT"
echo "📊 SUMMARY:" | tee -a "$OUTPUT"
echo "   - Correlation ID: $CORRELATION_ID" | tee -a "$OUTPUT"
echo "   - Total log lines: $(wc -l < "$OUTPUT")" | tee -a "$OUTPUT"
echo "   - Workflow log: $LATEST_LOG" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"
