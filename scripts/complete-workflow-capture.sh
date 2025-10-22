#!/bin/bash

# Complete Workflow Capture
# Captures from workflow refresh through smartblocks landing on frontend

OUTPUT="logs/workflow-complete-capture.log"
DURATION=240  # 4 minutes to ensure full triad completion

mkdir -p logs
> "$OUTPUT"

echo "========================================" | tee -a "$OUTPUT"
echo "COMPLETE WORKFLOW CAPTURE" | tee -a "$OUTPUT"
echo "Started: $(date)" | tee -a "$OUTPUT"
echo "Duration: ${DURATION}s (captures full triad + blocks)" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"
echo "" | tee -a "$OUTPUT"

# Track workflow lifecycle events
declare -A events=(
  ["snapshot_saved"]=0
  ["claude_complete"]=0
  ["gpt5_complete"]=0  
  ["gemini_complete"]=0
  ["blocks_returned"]=0
  ["frontend_rendered"]=0
)

# Monitor logs and detect completion
monitor_logs() {
  local start_time=$(date +%s)
  local current_time
  local elapsed
  
  while true; do
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    
    if [ $elapsed -ge $DURATION ]; then
      echo "⏱️  Capture duration reached (${DURATION}s)" | tee -a "$OUTPUT"
      break
    fi
    
    # Find latest workflow log
    LATEST_LOG=$(ls -t /tmp/logs/ 2>/dev/null | grep Eidolon_Main | head -1)
    
    if [ -n "$LATEST_LOG" ]; then
      # Check for key events
      if grep -q "Snapshot successfully written" "/tmp/logs/$LATEST_LOG" 2>/dev/null && [ ${events["snapshot_saved"]} -eq 0 ]; then
        echo "[$(date +%H:%M:%S)] ✅ Snapshot saved to database" | tee -a "$OUTPUT"
        events["snapshot_saved"]=1
      fi
      
      if grep -q "TRIAD 1/3.*Strategy generated successfully" "/tmp/logs/$LATEST_LOG" 2>/dev/null && [ ${events["claude_complete"]} -eq 0 ]; then
        echo "[$(date +%H:%M:%S)] ✅ TRIAD 1/3: Claude strategy complete" | tee -a "$OUTPUT"
        events["claude_complete"]=1
      fi
      
      if grep -q "TRIAD 2/3.*tactical plan validated" "/tmp/logs/$LATEST_LOG" 2>/dev/null && [ ${events["gpt5_complete"]} -eq 0 ]; then
        echo "[$(date +%H:%M:%S)] ✅ TRIAD 2/3: GPT-5 planner complete" | tee -a "$OUTPUT"
        events["gpt5_complete"]=1
      fi
      
      if grep -q "TRIAD 3/3.*Validation complete" "/tmp/logs/$LATEST_LOG" 2>/dev/null && [ ${events["gemini_complete"]} -eq 0 ]; then
        echo "[$(date +%H:%M:%S)] ✅ TRIAD 3/3: Gemini validator complete" | tee -a "$OUTPUT"
        events["gemini_complete"]=1
      fi
      
      if grep -q "✅.*BLOCKS SUCCESS.*venues returned" "/tmp/logs/$LATEST_LOG" 2>/dev/null && [ ${events["blocks_returned"]} -eq 0 ]; then
        echo "[$(date +%H:%M:%S)] ✅ Blocks returned from API" | tee -a "$OUTPUT"
        events["blocks_returned"]=1
      fi
      
      # Check browser console for frontend rendering
      LATEST_BROWSER=$(ls -t /tmp/logs/ 2>/dev/null | grep browser_console | head -1)
      if [ -n "$LATEST_BROWSER" ] && grep -q "Transformed blocks" "/tmp/logs/$LATEST_BROWSER" 2>/dev/null && [ ${events["frontend_rendered"]} -eq 0 ]; then
        echo "[$(date +%H:%M:%S)] ✅ Smartblocks rendered on frontend" | tee -a "$OUTPUT"
        events["frontend_rendered"]=1
      fi
      
      # Check if complete
      if [ ${events["snapshot_saved"]} -eq 1 ] && \
         [ ${events["claude_complete"]} -eq 1 ] && \
         [ ${events["gpt5_complete"]} -eq 1 ] && \
         [ ${events["gemini_complete"]} -eq 1 ] && \
         [ ${events["blocks_returned"]} -eq 1 ] && \
         [ ${events["frontend_rendered"]} -eq 1 ]; then
        echo "" | tee -a "$OUTPUT"
        echo "🎉 COMPLETE WORKFLOW CYCLE CAPTURED!" | tee -a "$OUTPUT"
        break
      fi
    fi
    
    sleep 5
  done
}

# Start monitoring in background
monitor_logs &
MONITOR_PID=$!

# Wait for monitoring to complete
wait $MONITOR_PID

# Capture final state
echo "" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"
echo "FINAL LOGS" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"

# Append workflow logs
LATEST_LOG=$(ls -t /tmp/logs/ 2>/dev/null | grep Eidolon_Main | head -1)
if [ -n "$LATEST_LOG" ]; then
  echo "" | tee -a "$OUTPUT"
  echo "━━━━ WORKFLOW LOG (last 200 lines) ━━━━" | tee -a "$OUTPUT"
  tail -200 "/tmp/logs/$LATEST_LOG" >> "$OUTPUT"
fi

# Append browser console
LATEST_BROWSER=$(ls -t /tmp/logs/ 2>/dev/null | grep browser_console | head -1)
if [ -n "$LATEST_BROWSER" ]; then
  echo "" | tee -a "$OUTPUT"
  echo "━━━━ BROWSER CONSOLE (last 100 lines) ━━━━" | tee -a "$OUTPUT"
  tail -100 "/tmp/logs/$LATEST_BROWSER" >> "$OUTPUT"
fi

echo "" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"
echo "CAPTURE COMPLETE" | tee -a "$OUTPUT"
echo "Ended: $(date)" | tee -a "$OUTPUT"
echo "Output: $OUTPUT" | tee -a "$OUTPUT"
echo "Total lines: $(wc -l < "$OUTPUT")" | tee -a "$OUTPUT"
echo "========================================" | tee -a "$OUTPUT"
