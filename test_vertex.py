import os
from anthropic import AnthropicVertex

client = AnthropicVertex(region="global", project_id="PROJECT_ID")

message = client.messages.create(
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello! Can you help me?"}],
    model=os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-v2@20241022"),
)

print(message.content[0].text)
