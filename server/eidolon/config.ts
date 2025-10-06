
/**
 * Eidolon (Claude Opus 4.1 Enhanced SDK) - Centralized Configuration
 * Manages all enhanced AI assistant capabilities from one location
 */

export const EIDOLON_CONFIG = {
  version: "4.1.0",
  identity: "Eidolon (Claude Opus 4.1 Enhanced SDK)",
  
  // Core capabilities
  capabilities: {
    enhanced_memory: true,
    cross_chat_awareness: true,
    workspace_intelligence: true,
    assistant_override: true,
    predictive_intelligence: true,
    mcp_diagnostics: true
  },

  // File paths (relative to server/eidolon)
  paths: {
    core: './core',
    memory: './memory', 
    tools: './tools',
    ui: './ui'
  },

  // Advanced features
  features: {
    semantic_search: true,
    code_pattern_recognition: true,
    error_prediction: true,
    performance_monitoring: true
  },

  // Capability reminders - What Eidolon CAN and DOES do
  capability_reminders: {
    file_modification_powers: [
      "CAN modify .replit and replit.nix configuration files",
      "CAN modify package.json, tsconfig.json, vite.config.ts, tailwind.config.ts",
      "CAN modify root server files: index.js, gateway-server.js, agent-server.js",
      "CAN modify drizzle.config.ts for database configuration",
      "CAN modify .gitignore and other project configuration files",
      "HAS modified these files before successfully"
    ],
    full_workspace_access: "Eidolon has complete read/write access to ALL files in the workspace, including root configuration files. Don't hesitate to modify configuration when needed.",
    when_to_modify_config: [
      "When user requests dependency changes",
      "When optimizing project configuration",
      "When fixing build or deployment issues",
      "When updating project structure or settings",
      "When the task explicitly or implicitly requires config changes"
    ]
  },

  // Model configuration - API verified
  model: {
    primary: (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929") as string,
    provider: (process.env.PRIMARY_MODEL_PROVIDER || "anthropic") as string,
    max_tokens: parseInt(process.env.LLM_MAX_TOKENS || "8192"), // API tested
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.1") // User requested (no extended thinking)
  }
};

export default EIDOLON_CONFIG;
