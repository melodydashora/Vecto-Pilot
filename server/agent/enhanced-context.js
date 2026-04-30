import {
  getEnhancedProjectContextBase,
  performInternetSearchBase,
  analyzeWorkspaceDeepBase,
  storeIdentityMemory,
  getIdentityMemory,
  storeCrossThreadMemory as storeCrossThreadMemoryBase,
  getCrossThreadMemory as getCrossThreadMemoryBase
} from "../lib/ai/context/enhanced-context-base.js";

const IDENTITY = "agent";
const MEMORY_TABLE = "agent_memory";
const SYSTEM_PROMPT = "You are Agent, a technical assistant with deep development knowledge. Provide accurate, up-to-date information with citations from web search results.";

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
  return storeIdentityMemory(IDENTITY, MEMORY_TABLE, title, content, metadata, ttlDays);
}

export async function getAgentMemory(userId = null, limit = 50) {
  return getIdentityMemory(IDENTITY, MEMORY_TABLE, userId, limit);
}

// Re-export shared functions
export const storeCrossThreadMemory = storeCrossThreadMemoryBase;
export const getCrossThreadMemory = getCrossThreadMemoryBase;