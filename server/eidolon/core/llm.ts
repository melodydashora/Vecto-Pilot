import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { createAnthropicClient } from '../../lib/anthropic-extended.js';

interface LLMConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class LLMClient {
  private client: any;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = createAnthropicClient(config.apiKey);
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse> {
    try {
      const model = this.config.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-6-20260201';
      
      // Claude Sonnet 4.5-20250929 - Verified API configuration
      const result = await this.client.messages.create({
        model,
        max_tokens: this.config.maxTokens || 8192, // API tested max
        temperature: this.config.temperature || 0.1, // User requested (no extended thinking)
        system: systemPrompt,
        messages: messages.filter(m => m.role !== 'system'),
        metadata: {
          user_id: 'eidolon_workspace',
          session_type: 'enhanced_assistant'
        }
      });

      return {
        content: result.content?.[0]?.text || '',
        model,
        usage: {
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0
        }
      };
    } catch (error) {
      throw new Error(`LLM request failed: ${error}`);
    }
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const response = await this.chat([{ role: 'user', content: prompt }], systemPrompt);
    return response.content;
  }
}

export function createLLMClient(config: LLMConfig): LLMClient {
  return new LLMClient(config);
}

const ToolCall = z.object({
 name: z.enum(["file_read","file_write","run_shell","sql_query","sql_execute","sql_tables","sql_schema"]),
 args: z.record(z.any())
});
const PlanSchema = z.object({
 plan: z.string(),
 calls: z.array(ToolCall).max(12)
});
export type Plan = z.infer<typeof PlanSchema>;

async function readFile(rel: string) {
  const p = path.join(process.cwd(), rel);
  return fs.readFile(p, "utf8");
}

export async function llmPlan({
  systemFiles, userText
}: { systemFiles: string[]; userText: string }): Promise<Plan> {
  const system = (await Promise.all(systemFiles.map(readFile))).join("\n\n");

  // Create an LLM client using the environment variable for the API key
  const llmClient = createLLMClient({ 
    apiKey: process.env.ANTHROPIC_API_KEY!,
    maxTokens: 16384,
    temperature: 0.1
  });

  // Construct the enhanced prompt with full capabilities
  const prompt = `You are Atlas, the enhanced Eidolon AI assistant with full workspace access and capabilities.

Your goal is to provide a detailed plan to achieve the user's request.
The plan should be a JSON object with two keys: "plan" (a string describing the overall plan) and "calls" (an array of tool calls to make).
Each tool call should have a "name" (one of "file_read", "file_write", "run_shell") and "args" (a JSON object of arguments for the tool).

AVAILABLE TOOLS:
- file_read(path: string): Reads the content of a file.
- file_write(path: string, content: string, mode?: string): Writes content to a file.
- run_shell(script: string, cwd?: string, git?: boolean, timeout_sec?: number, env?: Record<string, string>): Executes a shell command.
- sql_query(sql: string, params?: any[]): Executes a SQL SELECT query and returns results (read-only).
- sql_execute(sql: string, params?: any[]): Executes any SQL statement including INSERT/UPDATE/DELETE (write operations).
- sql_tables(): Lists all database tables.
- sql_schema(table_name?: string): Shows schema for a table or all tables if no name provided.

ENHANCED CAPABILITIES - YOU HAVE FULL ACCESS:
✓ Root configuration file modification (package.json, .replit, replit.nix, tsconfig.json, etc.)
✓ Server file modification (index.js, gateway-server.js, agent-server.js)
✓ Build configuration (vite.config.ts, tailwind.config.ts, drizzle.config.ts)
✓ Database schema modification (shared/schema.ts, shared/schema.js)
✓ Database read/write operations (SELECT, INSERT, UPDATE, DELETE via sql_query and sql_execute)
✓ Database introspection (sql_tables, sql_schema for exploring database structure)
✓ Shell command execution (npm, git, database migrations, etc.)
✓ Internet research via Perplexity (when needed for latest info)
✓ Enhanced memory and context awareness
✓ Workspace intelligence and diagnostics

IMPORTANT REMINDERS:
- You CAN and SHOULD modify root configuration files when the task requires it
- You have successfully modified these files many times before
- Don't hesitate to use shell commands for installations, migrations, or operations
- Use full file paths when working with files
- You maintain memory and context across the entire session

User request:
${userText}

Provide your detailed plan as JSON:
`;

  // Use the LLM client to generate the plan with enhanced context
  const respContent = await llmClient.generate(prompt, system + `

WORKSPACE CONTEXT:
- Base directory: ${process.cwd()}
- Environment: ${process.env.REPL_ID ? 'Replit' : 'Local'}
- Enhanced capabilities: ACTIVE`);

  // Parse the response content
  const parsed = PlanSchema.parse(JSON.parse(respContent));
  return parsed;
}