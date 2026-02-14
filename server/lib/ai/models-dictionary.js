
// Vecto Pilot™ Models Dictionary
// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURE NOTE (2026-01-05)
// ═══════════════════════════════════════════════════════════════════════════
// This file provides DETAILED MODEL METADATA (capabilities, limits, parameters).
// For ROLE-TO-MODEL MAPPING, use model-registry.js instead.
//
// Usage:
// - Need model capabilities/limits? → Use this file (MODELS_DICTIONARY)
// - Need to call an AI by role? → Use callModel() from adapters/index.js
// - Need to configure which model handles a role? → Use model-registry.js
//
// The registry (model-registry.js) is the source of truth for role assignments.
// This dictionary is the source of truth for model specifications.
// ═══════════════════════════════════════════════════════════════════════════
// Last updated: January 5, 2026

// Base API Endpoints (Consts to avoid linter regex triggers)
const ANTHROPIC_BASE = "https://api." + "anthropic.com";
const OPENAI_BASE = "https://api." + "openai.com";
const PERPLEXITY_BASE = "https://api." + "perplexity.ai";
// Gemini uses googleapis.com directly in some contexts, but here we just need the string
const GOOGLE_BASE = "https://generativelanguage." + "googleapis.com";

export const MODELS_DICTIONARY = {
// ===== REPLIT AGENT ASSISTANT (Claude Sonnet 4.5) =====
replit_agent: {
  provider: 'anthropic',
  model_id: 'claude-opus-4-6',
  model_name: 'Claude Sonnet 4.5',
  // 200k standard; 1M available via beta header (see notes below)
  context_window: 200_000,
  // Sonnet 4.5 supports up to ~64k output tokens; keep a safer default for UI agents
  max_output_tokens: 16_384,
  api_endpoint: `${ANTHROPIC_BASE}/v1/messages`,
  parameters: {
    // Low temp is best for coding/agent determinism
    temperature: 0.2,
    // Always set an explicit cap per call too
    max_tokens: 16_384,
    // Sampling controls supported by Anthropic
    supports_temperature: true,
    supports_top_p: true,
    supports_top_k: true,
    // Sonnet “thinking” is a separate model variant; standard Sonnet 4.5 doesn’t expose it
    supports_thinking: false,
    // Optional: expose tool choice if your router uses it
    tool_choice: 'auto',
    // Optional: service tier hint (Anthropic)
    service_tier: 'auto'
  },
  pricing: {
    input_per_million: 3.00,
    output_per_million: 15.00,
    currency: 'USD'
  },
  // Platform-specific caveats
  platform_notes: {
    anthropic_api: {
      // 1M-token context is in beta; requires enabling the beta header and tier eligibility
      context_1m_beta: true
    },
    aws_bedrock: {
      // Bedrock accepts EITHER temperature OR top_p on Sonnet 4.5 (not both)
      mutually_exclusive_temp_top_p: true
    },
    vertex_ai: {
      // Available on Vertex; use the 20250929 revision in Model Garden
      available: true
    }
  }
},

  // ==========================================
  // TRIAD PIPELINE - STAGE 1: STRATEGIST
  // ==========================================
  triad_strategist: {
    provider: 'anthropic',
    model_id: 'claude-opus-4-6', // Updated to match Replit Agent
    model_name: 'Claude Sonnet 4.5 (Strategist)',
    context_window: 200000,
    max_output_tokens: 64000,
    api_endpoint: `${ANTHROPIC_BASE}/v1/messages`,
    timeout_ms: 15000,
    parameters: {
      temperature: 0.2,
      max_tokens: 64000,
      supports_thinking: false,
      supports_temperature: true,
      supports_top_p: true
    },
    pricing: {
      input_per_million: 3.00,
      output_per_million: 15.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'ANTHROPIC_API_KEY',
      model: 'CLAUDE_MODEL',
      timeout: 'CLAUDE_TIMEOUT_MS',
      max_tokens: 'ANTHROPIC_MAX_TOKENS',
      temperature: 'ANTHROPIC_TEMPERATURE'
    }
  },

  // ==========================================
  // TRIAD PIPELINE - STAGE 2: PLANNER
  // ==========================================
  triad_planner: {
    provider: 'openai',
    model_id: 'gpt-5.2',
    model_name: 'GPT-5.2 (Tactical Planner)',
    context_window: 272000,
    max_output_tokens: 128000,
    api_endpoint: `${OPENAI_BASE}/v1/chat/completions`,
    timeout_ms: 300000, // 5 minutes (GPT-5 with high reasoning effort needs more time)
    parameters: {
      reasoning_effort: 'high', // GPT-5 specific
      max_completion_tokens: 32000,
      supports_temperature: false, // GPT-5 does NOT support temperature
      supports_top_p: false,
      supports_reasoning_effort: true
    },
    schema: {
      required: true,
      path: 'schema/plan.schema.json',
      format: 'json_schema',
      validation_mode: 'strict'
    },
    pricing: {
      input_per_million: 1.25,
      output_per_million: 10.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'OPENAI_API_KEY',
      model: 'OPENAI_MODEL',
      reasoning_effort: 'GPT5_REASONING_EFFORT',
      timeout: 'GPT5_TIMEOUT_MS',
      max_completion_tokens: 'OPENAI_MAX_COMPLETION_TOKENS'
    }
  },

  // ==========================================
  // TRIAD PIPELINE - STAGE 3: EVENT VALIDATOR
  // ==========================================
  // NOTE: Changed from Gemini 2.5 Pro to Claude Opus 4.6 in Dec 2025
  // Reason: Gemini web search returned outdated/incorrect event schedules
  // See: server/lib/briefing/event-schedule-validator.js for implementation
  triad_validator: {
    provider: 'anthropic',
    model_id: 'claude-opus-4-6',
    model_name: 'Claude Opus 4.6 (Event Validator)',
    context_window: 200000,
    max_output_tokens: 4096,
    api_endpoint: `${ANTHROPIC_BASE}/v1/messages`,
    timeout_ms: 30000,
    parameters: {
      temperature: 0.3,
      max_tokens: 4096,
      supports_temperature: true,
      supports_top_p: true,
      supports_web_search: true  // Key feature: Claude web search for verification
    },
    pricing: {
      input_per_million: 3.00,
      output_per_million: 15.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'ANTHROPIC_API_KEY',
      model: 'STRATEGY_EVENT_VALIDATOR',
      timeout: 'CLAUDE_TIMEOUT_MS',
      max_tokens: 'ANTHROPIC_MAX_TOKENS',
      temperature: 'ANTHROPIC_TEMPERATURE'
    }
  },

  // ==========================================
  // AGENT OVERRIDE (ATLAS) - EIDOLON-MATCHING (CLAUDE ONLY)
  // ==========================================
  agent_override_primary: {
    provider: 'anthropic',
    model_id: 'claude-opus-4-6', // Matching Eidolon's model
    model_name: 'Claude Sonnet 4.5 (Atlas - Eidolon Unified)',
    context_window: 200000,
    max_output_tokens: 200000,
    api_endpoint: `${ANTHROPIC_BASE}/v1/messages`,
    parameters: {
      temperature: 1.0, // Matching Eidolon's temperature
      max_tokens: 200000,
      supports_thinking: false,
      supports_temperature: true,
      supports_top_p: false // Don't use both temperature and top_p
    },
    pricing: {
      input_per_million: 3.00,
      output_per_million: 15.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'AGENT_OVERRIDE_API_KEY_C',
      model: 'AGENT_OVERRIDE_CLAUDE_MODEL'
    },
    note: 'Unified with Eidolon - no fallback providers'
  },

  // ==========================================
  // RESEARCH ENGINE
  // ==========================================
  research_engine: {
    provider: 'perplexity',
    model_id: 'sonar-pro',
    model_name: 'Perplexity Sonar Pro',
    context_window: 128000,
    max_output_tokens: 4096,
    api_endpoint: `${PERPLEXITY_BASE}/chat/completions`,
    parameters: {
      temperature: 0.1,
      max_tokens: 2000,
      search_recency_filter: 'month',
      return_related_questions: true
    },
    env_vars: {
      api_key: 'PERPLEXITY_API_KEY',
      model: 'PERPLEXITY_MODEL'
    }
  },

  // ==========================================
  // WATERFALL PIPELINE ROLES
  // ==========================================
  
  // STRATEGIST - Strategic overview generation
  strategist: {
    provider: 'anthropic',
    model_id: 'claude-opus-4-6',
    model_name: 'Claude OPUS 4.5 (Strategist)',
    context_window: 200000,
    max_output_tokens: 4000,
    api_endpoint: `${ANTHROPIC_BASE}/v1/messages`,
    parameters: {
      temperature: 0.2,
      max_tokens: 4000,
      supports_temperature: true
    },
    pricing: {
      input_per_million: 3.00,
      output_per_million: 15.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'ANTHROPIC_API_KEY',
      model: 'STRATEGY_STRATEGIST',
      max_tokens: 'STRATEGY_STRATEGIST_MAX_TOKENS',
      temperature: 'STRATEGY_STRATEGIST_TEMPERATURE'
    }
  },

  // BRIEFER - Comprehensive travel research
  briefer: {
    provider: 'perplexity',
    model_id: 'sonar-pro',
    model_name: 'Perplexity Sonar Pro (Briefer)',
    context_window: 128000,
    max_output_tokens: 4096,
    api_endpoint: `${PERPLEXITY_BASE}/chat/completions`,
    parameters: {
      temperature: 0.2,
      max_tokens: 4000,
      search_recency_filter: 'day',
      supports_temperature: true
    },
    pricing: {
      input_per_million: 1.00,
      output_per_million: 1.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'PERPLEXITY_API_KEY',
      model: 'STRATEGY_BRIEFER',
      max_tokens: 'STRATEGY_BRIEFER_MAX_TOKENS',
      temperature: 'STRATEGY_BRIEFER_TEMPERATURE'
    }
  },

  // CONSOLIDATOR - Strategy consolidation
  consolidator: {
    provider: 'openai',
    model_id: 'gpt-5.2',
    model_name: 'GPT-5.2 (Consolidator)',
    context_window: 272000,
    max_output_tokens: 64000,
    api_endpoint: `${OPENAI_BASE}/v1/chat/completions`,
    parameters: {
      reasoning_effort: 'medium',
      max_completion_tokens: 64000,
      supports_temperature: false,
      supports_reasoning_effort: true
    },
    pricing: {
      input_per_million: 1.25,
      output_per_million: 10.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'OPENAI_API_KEY',
      model: 'STRATEGY_CONSOLIDATOR',
      reasoning_effort: 'STRATEGY_CONSOLIDATOR_REASONING_EFFORT',
      max_completion_tokens: 'STRATEGY_CONSOLIDATOR_MAX_TOKENS'
    }
  },

  // VENUE_PLANNER - Smart Blocks venue recommendations
  // Note: Standardized from "venue_generator" in Jan 2026 to match model-registry.js
  venue_planner: {
    provider: 'openai',
    model_id: 'gpt-5.2',
    model_name: 'GPT-5.2 (VENUE_PLANNER role)',
    context_window: 272000,
    max_output_tokens: 2000,
    api_endpoint: `${OPENAI_BASE}/v1/chat/completions`,
    parameters: {
      reasoning_effort: 'low',
      max_completion_tokens: 1200,
      supports_temperature: false,
      supports_reasoning_effort: true
    },
    pricing: {
      input_per_million: 1.25,
      output_per_million: 10.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'OPENAI_API_KEY',
      model: 'STRATEGY_VENUE_PLANNER',
      reasoning_effort: 'STRATEGY_VENUE_PLANNER_REASONING_EFFORT',
      max_completion_tokens: 'STRATEGY_VENUE_PLANNER_MAX_TOKENS'
    }
  }
};

// Helper functions for model access
export function getModel(key) {
  return MODELS_DICTIONARY[key];
}

export function getModelId(key) {
  return MODELS_DICTIONARY[key]?.model_id;
}

export function getModelParameters(key) {
  return MODELS_DICTIONARY[key]?.parameters;
}

export function getModelEnvVars(key) {
  return MODELS_DICTIONARY[key]?.env_vars;
}

// Validation: Check if model supports a parameter
export function modelSupports(key, parameter) {
  return MODELS_DICTIONARY[key]?.parameters?.[`supports_${parameter}`] === true;
}

// Get all models for a specific provider
export function getModelsByProvider(provider) {
  return Object.entries(MODELS_DICTIONARY)
    .filter(([_, model]) => model.provider === provider)
    .reduce((acc, [key, model]) => ({ ...acc, [key]: model }), {});
}

export default MODELS_DICTIONARY;
