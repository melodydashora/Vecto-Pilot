
// Vecto Pilot™ Models Dictionary
// Centralized source of truth for all AI models used in the system
// Last updated: November 20, 2025

export const MODELS_DICTIONARY = {
// ===== REPLIT AGENT ASSISTANT (Claude Sonnet 4.5) =====
replit_agent: {
  provider: 'anthropic',
  model_id: 'claude-sonnet-4-5-20250929',
  model_name: 'Claude Sonnet 4.5',
  // 200k standard; 1M available via beta header (see notes below)
  context_window: 200_000,
  // Sonnet 4.5 supports up to ~64k output tokens; keep a safer default for UI agents
  max_output_tokens: 16_384,
  api_endpoint: 'https://api.anthropic.com/v1/messages',
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
    model_id: 'claude-sonnet-4-5-20250929', // Updated to match Replit Agent
    model_name: 'Claude Sonnet 4.5 (Strategist)',
    context_window: 200000,
    max_output_tokens: 64000,
    api_endpoint: 'https://api.anthropic.com/v1/messages',
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
    model_id: 'gpt-5',
    model_name: 'GPT-5 (Tactical Planner)',
    context_window: 272000,
    max_output_tokens: 128000,
    api_endpoint: 'https://api.openai.com/v1/chat/completions',
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
      max_tokens: 'OPENAI_MAX_COMPLETION_TOKENS'
    }
  },

  // ==========================================
  // TRIAD PIPELINE - STAGE 3: VALIDATOR
  // ==========================================
  triad_validator: {
    provider: 'google',
    model_id: 'gemini-2.5-pro',
    model_name: 'Gemini 2.5 Pro (Validator)',
    context_window: 1048576, // 1M tokens
    max_output_tokens: 8192,
    api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    timeout_ms: 20000,
    parameters: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      supports_temperature: true,
      supports_top_p: true,
      supports_top_k: true
    },
    pricing: {
      input_per_million: 3.50,
      output_per_million: 10.50,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'GEMINI_API_KEY',
      model: 'GEMINI_MODEL',
      timeout: 'GEMINI_TIMEOUT_MS',
      max_tokens: 'GEMINI_MAX_TOKENS',
      temperature: 'GEMINI_TEMPERATURE'
    }
  },

  // ==========================================
  // AGENT OVERRIDE (ATLAS) - FALLBACK CHAIN
  // ==========================================
  agent_override_primary: {
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-5-20250929', // Updated to match Replit Agent
    model_name: 'Claude Sonnet 4.5 (Atlas Primary)',
    context_window: 200000,
    max_output_tokens: 200000,
    api_endpoint: 'https://api.anthropic.com/v1/messages',
    parameters: {
      temperature: 1.0, // Maximum creativity for Atlas
      top_p: 0.95,
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
    }
  },

  agent_override_fallback_gpt5: {
    provider: 'openai',
    model_id: 'gpt-5',
    model_name: 'GPT-5 (Atlas Fallback)',
    context_window: 272000,
    max_output_tokens: 128000,
    api_endpoint: 'https://api.openai.com/v1/chat/completions',
    parameters: {
      reasoning_effort: 'high',
      max_completion_tokens: 128000,
      supports_temperature: false,
      supports_reasoning_effort: true
    },
    pricing: {
      input_per_million: 1.25,
      output_per_million: 10.00,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'AGENT_OVERRIDE_API_KEY_5',
      model: 'AGENT_OVERRIDE_GPT5_MODEL'
    }
  },

  agent_override_fallback_gemini: {
    provider: 'google',
    model_id: 'gemini-2.5-pro',
    model_name: 'Gemini 2.5 Pro (Atlas Fallback)',
    context_window: 1048576,
    max_output_tokens: 32768,
    api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    parameters: {
      temperature: 1.0,
      maxOutputTokens: 32768,
      supports_temperature: true,
      supports_top_p: true
    },
    pricing: {
      input_per_million: 3.50,
      output_per_million: 10.50,
      currency: 'USD'
    },
    env_vars: {
      api_key: 'AGENT_OVERRIDE_API_KEY_G',
      model: 'AGENT_OVERRIDE_GEMINI_MODEL'
    }
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
    api_endpoint: 'https://api.perplexity.ai/chat/completions',
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
    model_id: 'claude-sonnet-4-5-20250929',
    model_name: 'Claude Sonnet 4.5 (Strategist)',
    context_window: 200000,
    max_output_tokens: 4000,
    api_endpoint: 'https://api.anthropic.com/v1/messages',
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
    api_endpoint: 'https://api.perplexity.ai/chat/completions',
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
    model_id: 'gpt-5',
    model_name: 'GPT-5 (Consolidator)',
    context_window: 272000,
    max_output_tokens: 2000,
    api_endpoint: 'https://api.openai.com/v1/chat/completions',
    parameters: {
      temperature: 0.3,
      max_tokens: 2000,
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
      max_tokens: 'STRATEGY_CONSOLIDATOR_MAX_TOKENS',
      temperature: 'STRATEGY_CONSOLIDATOR_TEMPERATURE'
    }
  },

  // VENUE_GENERATOR - Smart venue recommendations
  venue_generator: {
    provider: 'openai',
    model_id: 'gpt-5',
    model_name: 'GPT-5 (Venue Generator)',
    context_window: 272000,
    max_output_tokens: 2000,
    api_endpoint: 'https://api.openai.com/v1/chat/completions',
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
      model: 'STRATEGY_VENUE_GENERATOR',
      reasoning_effort: 'STRATEGY_VENUE_GENERATOR_REASONING_EFFORT',
      max_tokens: 'STRATEGY_VENUE_GENERATOR_MAX_TOKENS'
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
