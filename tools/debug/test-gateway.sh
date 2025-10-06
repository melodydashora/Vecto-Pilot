
#!/bin/bash

echo "🧪 Testing Gateway Configuration"
echo "=================================="

# Wait for services to start
echo "Waiting for services to start..."
sleep 5

# Test gateway health
echo ""
echo "1. Testing Gateway Health (port 3000):"
curl -sS http://127.0.0.1:3000/health || echo "❌ Gateway health check failed"

echo ""
echo "2. Testing Gateway Info:"
curl -sS http://127.0.0.1:3000/gateway/info || echo "❌ Gateway info failed"

echo ""
echo "3. Testing Eidolon via Gateway Proxy (/eidolon/health):"
curl -sS http://127.0.0.1:3000/eidolon/health || echo "❌ Eidolon proxy failed"

echo ""
echo "4. Testing Agent via Gateway Proxy (/agent/health):"
curl -sS http://127.0.0.1:3000/agent/health || echo "❌ Agent proxy failed"

echo ""
echo "5. Testing Internal Eidolon (port 3001) - should work:"
curl -sS http://127.0.0.1:3001/health || echo "❌ Internal Eidolon failed"

echo ""
echo "6. Testing Internal Agent (port 43717) - should work:"
curl -sS http://127.0.0.1:43717/agent/health || echo "❌ Internal Agent failed"

echo ""
echo "7. Testing Assistant Override via Gateway:"
curl -sS "http://127.0.0.1:3000/api/assistant/verify-override" || echo "❌ Assistant override test failed"

echo ""
echo "✅ Gateway test complete!"
echo ""
echo "If all tests pass, your gateway is working correctly."
echo "Replit preview should now be stable on port 3000 (gateway)"
echo "Eidolon SDK runs internally on port 3001"
