
// server/assistant/policy-loader.js
// Load assistant-specific policy configuration

import { readFileSync } from 'fs';
import { join } from 'path';

export function loadAssistantPolicy(path = 'server/config/assistant-policy.json') {
  try {
    const configPath = join(process.cwd(), path);
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[assistant policy] Could not load from ${path}: ${e.message}`);
    return {
      identity: "assistant",
      capabilities: {
        internetSearch: true,
        claudeWebSearch: true,
        enhancedMemory: true,
        deepContextAwareness: true,
        threadAwareness: true,
        fsRead: true,
        fsWrite: true,
        ideFullAccess: true
      },
      triad: {
        enabled: process.env.TRIAD_ENABLED === 'true',
        invariants: {
          require_json_output: true,
          require_exact_model_ids: true
        }
      },
      memory: {
        table: process.env.ASSISTANT_MEMORY_TABLE || 'assistant_memory',
        defaultTTL: 90
      }
    };
  }
}
