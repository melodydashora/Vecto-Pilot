#!/bin/bash
# Clean startup script for Vecto Pilot
# Ensures all ports are free before starting

echo "🧹 Cleaning up existing processes..."
killall -9 node 2>/dev/null || true
sleep 3

echo "🔍 Verifying ports are free..."
lsof -ti:80 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true  
lsof -ti:3101 | xargs kill -9 2>/dev/null || true
sleep 2

echo "🚀 Starting Vecto Pilot..."
cd /home/runner/workspace
export PORT=80
export EIDOLON_PORT=3000
export NODE_ENV=development

node gateway-server.js
