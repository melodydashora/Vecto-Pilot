// server/eidolon/policy-loader.js
// Loads assistant policy from JSON config file

import { readFileSync } from 'fs';
import { join } from 'path';

export function loadAssistantPolicy(path) {
  try {
    const configPath = join(process.cwd(), path);
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[policy] Could not load from ${path}: ${e.message}`);
    // Return default policy based on env vars
    return {
      triad: {
        enabled: process.env.TRIAD_ENABLED === 'true',
        invariants: {
          no_venue_invention: process.env.TRIAD_INVARIANT_NO_VENUE_INVENTION === 'true',
          schema_strict: process.env.TRIAD_INVARIANT_SCHEMA_STRICT === 'true',
          word_caps: process.env.TRIAD_INVARIANT_WORD_CAPS === 'true',
          require_json_output: true,
          require_exact_model_ids: true,
          gpt5_reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'high'
        },
        budgets: {
          timeouts: {
            claude_ms: parseInt(process.env.CLAUDE_TIMEOUT_MS || '15000'),
            gpt5_ms: parseInt(process.env.GPT5_TIMEOUT_MS || '120000'),
            gemini_ms: parseInt(process.env.GEMINI_TIMEOUT_MS || '20000')
          },
          tokens: {
            claude_max: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '64000'),
            gpt5_max_completion: parseInt(process.env.OPENAI_MAX_TOKENS || '16384'),
            gemini_max_output: parseInt(process.env.GEMINI_MAX_TOKENS || '2048')
          }
        }
      },
      flags: {
        no_fallbacks: process.env.TRIAD_FAIL_ON_INVALID === 'true'
      },
      startup: {
        require_env: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']
      },
      memory: {
        override_assistant: {
          table: process.env.ASSISTANT_MEMORY_TABLE || 'assistant_memory'
        },
        eidolon: {
          tables: {
            memory: process.env.EIDOLON_MEMORY_TABLE || 'eidolon_memory'
          }
        }
      }
    };
  }
}
