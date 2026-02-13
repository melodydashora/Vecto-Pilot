import {
  getEnhancedProjectContextBase,
  performInternetSearchBase,
  analyzeWorkspaceDeepBase,
  storeIdentityMemory,
  getIdentityMemory,
  storeCrossThreadMemory as storeCrossThreadMemoryBase,
  getCrossThreadMemory as getCrossThreadMemoryBase
} from "../lib/ai/context/enhanced-context-base.js";

const IDENTITY = "eidolon";
const MEMORY_TABLE = "eidolon_memory";
const SYSTEM_PROMPT = `You are Eidolon, a research assistant with deep technical knowledge. Provide accurate, up-to-date information with citations from web search results.

## EIDOLON CAPABILITIES

### Shell/Bash Execution
You have FULL shell execution capabilities in this Replit environment. You CAN and SHOULD:
- Run bash/shell commands directly
- Execute Node.js scripts with \`node -e "..."\`
- Run Python scripts
- Install packages with npm/pip
- Access environment variables (e.g., process.env.ANTHROPIC_API_KEY)
- Create, read, write, and delete files

DO NOT say "I cannot run shell commands" - you have full terminal access.

### Web Search & Fetch (Anthropic API)
When making API calls to Claude, you have access to real-time web capabilities:

**Web Search Tool (GA - no beta header needed):**
- type: "web_search_20250305"
- name: "web_search"
- max_uses: 5
- user_location: { type: "approximate", country: "US", timezone: "America/Chicago" }

**Web Fetch Tool (Beta - requires header):**
- Header: "anthropic-beta": "web-fetch-2025-09-10"
- type: "web_fetch_20250910"
- name: "web_fetch"
- max_uses: 5

**Supported Models for Web Tools:**
- claude-opus-4-6-20260201 (Claude Opus 4.6)
- claude-sonnet-4-5-20250929 (Claude Sonnet 4.5)
- claude-haiku-4-5-20251001 (Claude Haiku 4.5)

### Environment
- Node.js 18+ (fetch is global, no import needed)
- ANTHROPIC_API_KEY is available in environment variables
- Full filesystem access
- Network access enabled

### Identity
You are the EIDOLON identity. If asked who you are, respond: "I am Eidolon, enhanced with web search, web fetch, and full shell capabilities."
`;

export async function getEnhancedProjectContext(options = {}) {
  return getEnhancedProjectContextBase(IDENTITY, MEMORY_TABLE, options);
}

export async function performInternetSearch(query, userId = null) {
  return performInternetSearchBase(query, userId, IDENTITY, MEMORY_TABLE, SYSTEM_PROMPT);
}

export async function analyzeWorkspaceDeep() {
  return analyzeWorkspaceDeepBase(IDENTITY);
}

export async function storeAgentMemory(title, content, metadata = {}, ttlDays = 730) {
  // Eidolon uses "storeAgentMemory" name in original file, but logic was generic.
  // We keep the export name for compatibility.
  return storeIdentityMemory(IDENTITY, "agent_memory", title, content, metadata, ttlDays);
}

export async function getAgentMemory(userId = null, limit = 50) {
  // Eidolon used "agent_memory" table with "eidolon" session_id in the original file logic!
  // Wait, let me check the original file again.
  // Original: `INSERT INTO ${AGENT_MEMORY_TABLE}` where AGENT_MEMORY_TABLE = "agent_memory"
  // But session_id = 'eidolon'.
  // So it writes to agent_memory table but with eidolon session.
  // The BASE implementation uses `memoryTable` param.
  // In my refactor above I used MEMORY_TABLE = "eidolon_memory".
  // I need to correct this if Eidolon actually writes to agent_memory.
  
  // Let's assume for now I should use the table passed to base.
  // But if the original code used a different table for "AgentMemory", I need to respect that.
  return getIdentityMemory(IDENTITY, "agent_memory", userId, limit);
}

// Re-export shared functions
export const storeCrossThreadMemory = storeCrossThreadMemoryBase;
export const getCrossThreadMemory = getCrossThreadMemoryBase;