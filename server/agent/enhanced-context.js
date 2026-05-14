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

// TODO(auth-hardening Item 6, deferred 2026-05-13): this wrapper delegates to
// storeIdentityMemory, which is a no-op for agent_memory due to a
// schema-vs-code mismatch (see TODO at enhanced-context-base.js:385). The
// signature also does not accept userId, so even if the base were repaired
// this call would still pool writes under NULL user_id. When the
// schema-repair workstream lands, add a required userId parameter and apply
// the ENFORCE_USERID_UUID flag-gated guard per Item 1 commit 8c26e84b
// (cross_thread_memory closure).
export async function storeAgentMemory(title, content, metadata = {}, ttlDays = 730) {
  return storeIdentityMemory(IDENTITY, MEMORY_TABLE, title, content, metadata, ttlDays);
}

// TODO(auth-hardening Item 6, deferred 2026-05-13): this wrapper delegates to
// getIdentityMemory, which currently returns [] for agent_memory because the
// SELECT filters on a column (session_id) that does not exist on the live
// schema (see TODO at enhanced-context-base.js:411). When the schema-repair
// workstream lands, change the base to filter by user_id and require a
// non-null userId per Item 1 commit 8c26e84b's pattern; this wrapper already
// threads userId through so no signature change is needed here.
export async function getAgentMemory(userId = null, limit = 50) {
  return getIdentityMemory(IDENTITY, MEMORY_TABLE, userId, limit);
}

// Re-export shared functions
export const storeCrossThreadMemory = storeCrossThreadMemoryBase;
export const getCrossThreadMemory = getCrossThreadMemoryBase;