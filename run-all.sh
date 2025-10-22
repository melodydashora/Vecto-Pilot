#!/bin/bash
# Vecto Pilot - Supervisor Script
# Keeps all 3 servers running with automatic restart

trap 'killall node; exit' SIGINT SIGTERM

echo "Starting Vecto Pilot - 3 Server Architecture"
echo "============================================="

# Function to start and monitor a process
monitor_process() {
    local name=$1
    local script=$2
    local port=$3
    local log=$4
    
    while true; do
        echo "[$(date +%H:%M:%S)] Starting $name on port $port..."
        node "$script" > "$log" 2>&1 &
        local pid=$!
        echo "[$(date +%H:%M:%S)] $name started (PID: $pid)"
        
        # Wait for process to die
        wait $pid
        echo "[$(date +%H:%M:%S)] $name died, restarting in 2s..."
        sleep 2
    done
}

# Start each server in background with monitoring
monitor_process "Agent" "agent-server.js" "43717" "/tmp/agent.log" &
sleep 3

monitor_process "Eidolon" "index.js" "3101" "/tmp/eidolon.log" &
sleep 3

monitor_process "Gateway" "gateway-server.js" "80" "/tmp/gateway.log" &

# Keep script alive
echo "All servers running. Press Ctrl+C to stop."
wait
