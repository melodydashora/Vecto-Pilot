
#!/bin/bash

echo "🔬 Testing Assistant Override Fix - Middleware Order Corrected"
echo "============================================================="

# Wait for services to start
sleep 2

echo ""
echo "1. Gateway health:"
curl -sS http://127.0.0.1:3000/health | jq . || echo "❌ Gateway health failed"

echo ""
echo "2. SDK health via proxy:"
curl -sS http://127.0.0.1:3000/eidolon/health | jq . || echo "❌ SDK proxy failed"

echo ""
echo "3. Assistant override (should work now):"
curl -sS "http://127.0.0.1:3000/assistant/verify-override" || echo "❌ Assistant override failed"

echo ""
echo "✅ All tests complete - checking trace logs for proper routing..."
