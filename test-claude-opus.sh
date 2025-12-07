
#!/bin/bash

echo "=== Testing Claude Opus 4.5 (Standard) ==="
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-5-20251101",
    "max_tokens": 1024,
    "temperature": 0.7,
    "messages": [
      {
        "role": "user",
        "content": "Hello! Please confirm you are Claude Opus 4.5 and tell me one interesting fact about AI."
      }
    ]
  }' | jq .

echo ""
echo "=== Testing Claude 3.7 Sonnet (Extended Thinking) ==="
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-7-sonnet-20250219",
    "max_tokens": 20000,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 16000
    },
    "messages": [
      {
        "role": "user",
        "content": "Analyze the pros and cons of using extended thinking for a rideshare driver strategy app."
      }
    ]
  }' | jq .

echo ""
echo "=== Testing Claude Opus 4.5 (Extended Thinking) ==="
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-5-20251101",
    "max_tokens": 32000,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 24000
    },
    "messages": [
      {
        "role": "user",
        "content": "Design a comprehensive multi-city rideshare optimization strategy that balances driver earnings, passenger experience, and traffic patterns."
      }
    ]
  }' | jq .
