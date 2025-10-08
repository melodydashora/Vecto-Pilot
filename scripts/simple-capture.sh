#!/bin/bash

# Simple Workflow Capture Script
# Captures logs from workflow restart to completion

OUTPUT_FILE="logs/workflow-capture.log"
DURATION=90

mkdir -p logs
> "$OUTPUT_FILE"

echo "========================================" | tee -a "$OUTPUT_FILE"
echo "WORKFLOW LOG CAPTURE STARTED" | tee -a "$OUTPUT_FILE"
echo "Time: $(date)" | tee -a "$OUTPUT_FILE"
echo "Duration: ${DURATION}s" | tee -a "$OUTPUT_FILE"
echo "========================================" | tee -a "$OUTPUT_FILE"
echo "" | tee -a "$OUTPUT_FILE"

# Function to capture and label logs
capture_logs() {
  local label=$1
  local logfile=$2
  
  echo "" | tee -a "$OUTPUT_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT_FILE"
  echo "[$label]" | tee -a "$OUTPUT_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$OUTPUT_FILE"
  
  if [ -f "$logfile" ]; then
    tail -100 "$logfile" | tee -a "$OUTPUT_FILE"
  else
    echo "Log file not found: $logfile" | tee -a "$OUTPUT_FILE"
  fi
}

# Capture initial state
capture_logs "INITIAL WORKFLOW LOGS" "/tmp/logs/$(ls -t /tmp/logs/ | grep Eidolon_Main | head -1)"

# Wait and capture during execution
for i in {1..6}; do
  sleep 15
  echo "" | tee -a "$OUTPUT_FILE"
  echo "[$(date +%H:%M:%S)] Capture checkpoint $i/6" | tee -a "$OUTPUT_FILE"
  
  # Find latest workflow log
  LATEST_LOG=$(ls -t /tmp/logs/ 2>/dev/null | grep Eidolon_Main | head -1)
  if [ -n "$LATEST_LOG" ]; then
    tail -50 "/tmp/logs/$LATEST_LOG" >> "$OUTPUT_FILE"
  fi
done

# Final capture
echo "" | tee -a "$OUTPUT_FILE"
echo "========================================" | tee -a "$OUTPUT_FILE"
echo "FINAL CAPTURE" | tee -a "$OUTPUT_FILE"
echo "========================================" | tee -a "$OUTPUT_FILE"

# Capture final workflow logs
LATEST_LOG=$(ls -t /tmp/logs/ 2>/dev/null | grep Eidolon_Main | head -1)
capture_logs "FINAL WORKFLOW LOGS" "/tmp/logs/$LATEST_LOG"

# Capture browser console
LATEST_BROWSER=$(ls -t /tmp/logs/ 2>/dev/null | grep browser_console | head -1)
capture_logs "BROWSER CONSOLE" "/tmp/logs/$LATEST_BROWSER"

echo "" | tee -a "$OUTPUT_FILE"
echo "========================================" | tee -a "$OUTPUT_FILE"
echo "CAPTURE COMPLETE" | tee -a "$OUTPUT_FILE"
echo "Output saved to: $OUTPUT_FILE" | tee -a "$OUTPUT_FILE"
echo "Total lines: $(wc -l < "$OUTPUT_FILE")" | tee -a "$OUTPUT_FILE"
echo "========================================" | tee -a "$OUTPUT_FILE"
