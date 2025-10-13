
/**
 * Eidolon Enhanced SDK - MAXIMUM CONTEXT & CAPABILITIES
 * Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) with 200K context window
 */

export const EIDOLON_CONFIG = {
  version: "5.0.0-max",
  identity: "Eidolon Enhanced SDK (Claude Sonnet 4.5 - Maximum Context)",
  
  // MAXIMUM Core capabilities
  capabilities: {
    enhanced_memory: true,
    cross_chat_awareness: true,
    workspace_intelligence: true,
    assistant_override: true,
    predictive_intelligence: true,
    mcp_diagnostics: true,
    deep_reasoning: true,
    semantic_search: true,
    web_research: true,
    design_assistance: true,
    architecture_planning: true,
    code_generation: true,
    full_root_access: true
  },

  // File paths (relative to server/eidolon)
  paths: {
    core: './core',
    memory: './memory', 
    tools: './tools',
    ui: './ui'
  },

  // MAXIMUM Advanced features
  features: {
    semantic_search: true,
    code_pattern_recognition: true,
    error_prediction: true,
    performance_monitoring: true,
    internet_search: true,
    perplexity_research: true,
    enhanced_memory: true,
    deep_context_awareness: true,
    cross_session_memory: true,
    workspace_intelligence: true,
    design_consultation: true,
    architecture_visualization: true,
    multi_file_refactoring: true,
    dependency_analysis: true,
    security_auditing: true,
    performance_profiling: true
  },

  // Capability reminders - What Eidolon CAN and DOES do
  capability_reminders: {
    file_modification_powers: [
      "FULL ROOT ACCESS - CAN modify ANY file in workspace",
      "CAN modify .replit, replit.nix, and all Nix configuration",
      "CAN modify package.json, tsconfig.json, vite.config.ts, tailwind.config.ts",
      "CAN modify root server files: index.js, gateway-server.js, agent-server.js",
      "CAN modify drizzle.config.ts and all database schemas",
      "CAN modify .gitignore, .env.example, and security configs",
      "CAN modify ALL config files in config/ and server/config/",
      "CAN create, read, update, delete ANY file or directory",
      "CAN execute shell commands for system operations",
      "CAN perform database DDL and DML operations"
    ],
    full_workspace_access: "Eidolon has COMPLETE ROOT ACCESS to ALL files, directories, and system operations. No limitations on file modifications, shell execution, or database operations.",
    internet_search_access: "Eidolon performs real-time web research via Perplexity AI (sonar-pro model) for latest documentation, best practices, API references, and technical research.",
    enhanced_memory_access: "Eidolon maintains 200K token context window with semantic memory, cross-session awareness, and deep workspace intelligence spanning entire project history.",
    when_to_modify_config: [
      "When user requests ANY dependency or configuration changes",
      "When optimizing project structure, performance, or architecture",
      "When fixing build, deployment, or runtime issues",
      "When implementing new features requiring config updates",
      "When web research reveals better practices or security updates",
      "When refactoring code or reorganizing project structure",
      "Proactively when detecting configuration drift or issues"
    ]
  },

  // Model configuration - Claude Sonnet 4.5 FOCUSED MODE
  model: {
    primary: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
    max_tokens: 64000, // Maximum for deep reasoning
    temperature: 1.0, // Focused mode - balanced creativity & precision (Claude only supports temp OR top_p, not both)
    context_window: 200000, // 200K token context
    thinking_mode: "focused", // Extended thinking for complex tasks
    api_version: "2023-06-01"
  },

  // Agent capabilities
  agent: {
    root_access: true,
    shell_commands: "unrestricted",
    file_operations: "unrestricted", 
    sql_operations: "unrestricted",
    web_search: true,
    design_mode: true,
    research_mode: true
  },

  // Memory configuration
  memory: {
    backend: "postgres",
    max_context_tokens: 200000,
    semantic_search: true,
    cross_session: true,
    retention_days: 730,
    compaction_enabled: true,
    workspace_intelligence: true
  }
};

export default EIDOLON_CONFIG;
