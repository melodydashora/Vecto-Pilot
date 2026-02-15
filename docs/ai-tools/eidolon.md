Based on the code changes in `server/eidolon/core/llm.ts`, the `LLMClient` class exposes a `generate` convenience method and returns a structured `LLMResponse` containing usage data. The documentation should be updated to reflect these capabilities. The `llmPlan` tools and configuration in the documentation already match the code.

Here is the updated section for `LLM Client & Planning`:


### LLM Client & Planning

Claude API wrapper with token tracking and autonomous planning capabilities (Atlas):

typescript
import { LLMClient, llmPlan } from './core/llm';

// Basic Chat
const client = new LLMClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-opus-4-6',
  maxTokens: 8192,
  temperature: 0.1
});

// Chat with full response (content + usage)
const response = await client.chat([
  { role: 'user', content: 'Analyze this code...' }
], systemPrompt);

console.log(response.content);
console.log(response.usage); // { inputTokens: ..., outputTokens: ... }

// Simple Generation (returns string content directly)
const text = await client.generate('Explain quantum computing');

// Autonomous Planning
// Generates execution plans using tools: 
// - file_read, file_write
// - run_shell
// - sql_query, sql_