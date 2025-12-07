
#!/bin/bash
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
