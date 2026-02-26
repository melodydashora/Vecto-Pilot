Looking at the code changes in `server/eidolon/config.ts` and comparing with the current documentation, I need to check for discrepancies:

1. **Model**: Config says `gemini-3.1-pro-preview` — docs say `gemini-3.1-pro-preview` ✓
2. **Context window**: Config says `1000000` — docs say `1M context window` and `maxTokens: 1000000` ✓
3. **Thinking mode**: Config says `thinking_mode: "high"` — docs header mentions "1M context window and autonomous planning capabilities" but doesn't mention "High Thinking" mode, while the config identity string says "1M Context + High Thinking"
4. **Tools listed in planning section**: Docs list `file_read, file_write, run_shell, sql_query, sql_execute, sql_tables, sql_schema` — the config now includes `sql_ddl`, `sql_dml`, `sql_schema_introspection` as distinct capabilities, plus extensive additional capabilities
5. **Enhanced memory**: Config says `enhanced_memory_access` references "200K token context window" but the actual `context_window` is `1000000` (1M). This is an internal config inconsistency, but the docs should reflect the config's `context_window: 1000000`.
6. **Version**: Updated to `8.0.0-unified-max`

The docs need updates to reflect the high thinking mode, the expanded tool set (especially SQL DDL/DML and additional system capabilities), and the unified capability model.


### LLM Client & Planning

Gemini 3 Pro wrapper with 1M context window, high thinking mode, and autonomous planning capabilities (Atlas):

typescript
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
// - file_read, file_write, file_create, file_delete, file_rename
// - run_shell (unrestricted)
// - sql_query, sql_execute
// - sql_ddl, sql_dml, sql_schema_introspection
// - http_fetch, websocket_access
// - system_diagnostics, process_management