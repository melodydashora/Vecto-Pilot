#!/usr/bin/env bash
set -e
node -e "console.log('node', process.version)"
echo "Testing agent LLM health endpoint..."
curl -s http://localhost:3000/api/agent/llm/health | python3 -m json.tool || true
echo ""
echo "Testing memory summary endpoint..."
curl -s http://localhost:3000/api/assistant/memory/summary | python3 -m json.tool || true