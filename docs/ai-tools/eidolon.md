### Configuration (`server/eidolon/config.ts`)

The `EIDOLON_CONFIG` object defines the core identity, model parameters, and unified capabilities of the Eidolon AI system. 

- **Version:** `8.0.0-unified-max`
- **Model:** `gemini-3.1-pro-preview`
- **Context Window:** 1,000,000 tokens
- **Thinking Mode:** `high`
- **Access Level:** Complete IDE Integration with full root access, bypassing the standard assistant entirely.

### LLM Client & Planning

Gemini 3 Pro wrapper with 1M context window, high thinking mode, and autonomous planning capabilities (Atlas):

```typescript
import { LLMClient, llmPlan } from './core/llm';

// Basic Chat
const client = new LLMClient({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-3.1-pro-preview',
  maxTokens: 1000000,
  temperature: 0.1,
  thinkingMode: 'high'
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
// Generates execution plans using unified tools:
// - fs_read, fs_write, fs_create, fs_delete, fs_rename
// - shell_exec, shell_unrestricted
// - sql_query, sql_execute, sql_ddl, sql_dml, sql_schema_introspection
// - http_fetch, websocket_access, api_integration
// - system_diagnostics, process_management
```