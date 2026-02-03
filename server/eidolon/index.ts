
/**
 * Eidolon Enhanced SDK - Main Export
 * Consolidated access point for all Eidolon capabilities
 */

// Core functionality
export { buildCodeMap, loadLatestCodeMap, buildAndPersist } from './core/code-map';
export { readJson, writeJson } from './core/memory-store';
export { contextAwareness } from './core/context-awareness';
export { memoryManager } from './core/memory-enhanced';

// Configuration
export { EIDOLON_CONFIG } from './config';

// Assistant system (commented out - files don't exist)
// export { default as unifiedAssistant } from '../assistant/unified-assistant';
// export { default as memoryRouter } from '../assistant/memory-router';

// Types and interfaces
export interface EidolonCapabilities {
  enhanced_memory: boolean;
  cross_chat_awareness: boolean;
  workspace_intelligence: boolean;
  assistant_override: boolean;
  predictive_intelligence: boolean;
}

export interface EidolonSession {
  id: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  created: number;
  lastActivity: number;
}

export const EIDOLON_IDENTITY = "🧠 Eidolon (Claude Opus 4.1 Enhanced SDK)";
export const EIDOLON_VERSION = "4.1.0";
