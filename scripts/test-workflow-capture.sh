#!/bin/bash

# Test Workflow Capture Script
# 
# This script:
# 1. Starts the workflow log capture
# 2. Triggers a workflow refresh
# 3. Waits for completion
# 4. Displays the captured log

echo "🔍 Starting workflow log capture..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create logs directory if it doesn't exist
mkdir -p logs

# Clear previous capture
rm -f logs/workflow-capture.log

# Start capture in background
node scripts/capture-workflow-logs.js &
CAPTURE_PID=$!

echo "📊 Log capture started (PID: $CAPTURE_PID)"
echo "📁 Output: logs/workflow-capture.log"
echo ""

# Wait for capture to initialize
sleep 2

# Trigger workflow activity by making a test request
echo "🔄 Triggering workflow refresh (simulating GPS refresh + blocks request)..."
echo ""

# You can add curl commands here to trigger the workflow
# For example:
# curl -X POST http://localhost:5000/api/location/snapshot \
#   -H "Content-Type: application/json" \
#   -d '{"lat": 33.1285518817139, "lng": -96.87550988719626}'

echo "⏳ Waiting for workflow completion (120s max)..."
echo "   Watch the logs in real-time: tail -f logs/workflow-capture.log"
echo ""

# Wait for capture process to complete
wait $CAPTURE_PID

echo ""
echo "✅ Capture complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📄 Captured log summary:"
echo ""

# Display log summary
if [ -f logs/workflow-capture.log ]; then
  echo "Total lines: $(wc -l < logs/workflow-capture.log)"
  echo ""
  echo "Section breakdown:"
  grep -c "\[WORKFLOW\]" logs/workflow-capture.log 2>/dev/null && echo "  WORKFLOW events: $(grep -c '\[WORKFLOW\]' logs/workflow-capture.log)" || echo "  WORKFLOW events: 0"
  grep -c "\[DATABASE\]" logs/workflow-capture.log 2>/dev/null && echo "  DATABASE ops: $(grep -c '\[DATABASE\]' logs/workflow-capture.log)" || echo "  DATABASE ops: 0"
  grep -c "\[TRIAD\]" logs/workflow-capture.log 2>/dev/null && echo "  TRIAD events: $(grep -c '\[TRIAD\]' logs/workflow-capture.log)" || echo "  TRIAD events: 0"
  grep -c "\[BLOCKS\]" logs/workflow-capture.log 2>/dev/null && echo "  BLOCKS events: $(grep -c '\[BLOCKS\]' logs/workflow-capture.log)" || echo "  BLOCKS events: 0"
  grep -c "\[HTTP\]" logs/workflow-capture.log 2>/dev/null && echo "  HTTP requests: $(grep -c '\[HTTP\]' logs/workflow-capture.log)" || echo "  HTTP requests: 0"
  echo ""
  echo "View full log: cat logs/workflow-capture.log"
else
  echo "❌ No log file generated"
fi
