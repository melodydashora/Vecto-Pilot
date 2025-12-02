
#!/bin/bash

# Test OpenAI Threads API - Create a message in a thread
# Replace thread_abc123 with an actual thread ID from your OpenAI account

echo "🧪 Testing OpenAI Threads API - Create Message"
echo "================================================"
echo ""

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ ERROR: OPENAI_API_KEY environment variable is not set"
  echo "Please set it in Replit Secrets"
  exit 1
fi

echo "✅ API Key found (length: ${#OPENAI_API_KEY} chars)"
echo ""

# Note: You need to replace thread_abc123 with a real thread ID
# To create a thread first, run:
# curl https://api.openai.com/v1/threads -H "Authorization: Bearer $OPENAI_API_KEY" -H "OpenAI-Beta: assistants=v2" -X POST

THREAD_ID="thread_abc123"  # Replace with actual thread ID

echo "📤 Sending message to thread: $THREAD_ID"
echo ""

curl -X POST "https://api.openai.com/v1/threads/${THREAD_ID}/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "OpenAI-Beta: assistants=v2" \
  -d '{
    "role": "user",
    "content": "How does AI work? Explain it in simple terms."
  }' | python3 -m json.tool || echo "❌ API call failed"

echo ""
echo "================================================"
echo "✅ Test complete"
