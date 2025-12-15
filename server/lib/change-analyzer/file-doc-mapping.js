/**
 * File-to-Documentation Mapping
 *
 * Maps file patterns to documentation that may need updating when those files change.
 * Used by the Change Analyzer to flag potential documentation updates.
 */

/**
 * Mapping of file patterns to affected documentation
 * Pattern format: glob-like patterns matched against file paths
 */
export const FILE_TO_DOC_MAP = {
  // API Routes
  'server/api/': {
    docs: ['docs/architecture/api-reference.md'],
    priority: 'high',
    reason: 'API endpoint changes'
  },
  'server/api/auth/': {
    docs: ['docs/architecture/auth-system.md', 'docs/architecture/api-reference.md'],
    priority: 'high',
    reason: 'Authentication changes'
  },
  'server/api/strategy/': {
    docs: ['docs/architecture/api-reference.md', 'docs/architecture/strategy-framework.md'],
    priority: 'high',
    reason: 'Strategy API changes'
  },
  'server/api/briefing/': {
    docs: ['docs/architecture/api-reference.md'],
    priority: 'medium',
    reason: 'Briefing API changes'
  },
  'server/api/mcp/': {
    docs: ['docs/ai-tools/mcp.md', 'mcp-server/README.md'],
    priority: 'high',
    reason: 'MCP tool changes'
  },

  // AI Layer
  'server/lib/ai/': {
    docs: ['docs/preflight/ai-models.md', 'docs/architecture/ai-pipeline.md'],
    priority: 'high',
    reason: 'AI model/adapter changes'
  },
  'server/lib/ai/adapters/': {
    docs: ['docs/preflight/ai-models.md', 'docs/architecture/ai-pipeline.md', 'server/lib/ai/README.md'],
    priority: 'high',
    reason: 'Model adapter changes'
  },

  // Strategy Pipeline
  'server/lib/strategy/': {
    docs: ['docs/architecture/strategy-framework.md', 'docs/architecture/ai-pipeline.md'],
    priority: 'high',
    reason: 'Strategy pipeline changes'
  },

  // Venue/Location
  'server/lib/venue/': {
    docs: ['docs/preflight/location.md'],
    priority: 'medium',
    reason: 'Venue logic changes'
  },
  'server/lib/location/': {
    docs: ['docs/preflight/location.md', 'docs/architecture/constraints.md'],
    priority: 'high',
    reason: 'Location/GPS changes'
  },

  // Database
  'shared/schema.js': {
    docs: ['docs/architecture/database-schema.md', 'docs/preflight/database.md'],
    priority: 'high',
    reason: 'Database schema changes'
  },
  'server/db/': {
    docs: ['docs/architecture/database-schema.md', 'docs/preflight/database.md'],
    priority: 'medium',
    reason: 'Database connection changes'
  },

  // Client Components
  'client/src/components/': {
    docs: ['docs/architecture/client-structure.md'],
    priority: 'medium',
    reason: 'Component changes'
  },
  'client/src/hooks/': {
    docs: ['docs/architecture/client-structure.md'],
    priority: 'medium',
    reason: 'Hook changes'
  },
  'client/src/contexts/': {
    docs: ['docs/architecture/client-structure.md'],
    priority: 'high',
    reason: 'Context provider changes'
  },
  'client/src/pages/': {
    docs: ['docs/architecture/client-structure.md'],
    priority: 'medium',
    reason: 'Page changes'
  },

  // Agent/Eidolon/Assistant
  'server/agent/': {
    docs: ['docs/ai-tools/agent.md', 'server/agent/README.md'],
    priority: 'medium',
    reason: 'Workspace agent changes'
  },
  'server/eidolon/': {
    docs: ['docs/ai-tools/eidolon.md', 'server/eidolon/README.md'],
    priority: 'medium',
    reason: 'Eidolon SDK changes'
  },
  'server/assistant/': {
    docs: ['docs/ai-tools/assistant.md', 'server/assistant/README.md'],
    priority: 'medium',
    reason: 'Assistant changes'
  },

  // MCP Server
  'mcp-server/': {
    docs: ['docs/ai-tools/mcp.md', 'mcp-server/README.md'],
    priority: 'high',
    reason: 'MCP server changes'
  },

  // Configuration
  'server/config/': {
    docs: ['docs/architecture/constraints.md'],
    priority: 'low',
    reason: 'Configuration changes'
  },

  // Jobs/Workers
  'server/jobs/': {
    docs: ['docs/architecture/server-structure.md'],
    priority: 'low',
    reason: 'Background job changes'
  },

  // Core Files
  'gateway-server.js': {
    docs: ['docs/architecture/server-structure.md', 'CLAUDE.md'],
    priority: 'high',
    reason: 'Main server changes'
  },
  'CLAUDE.md': {
    docs: [],  // Self-documenting
    priority: 'low',
    reason: 'Guidelines updated'
  },
  'ARCHITECTURE.md': {
    docs: [],  // Self-documenting
    priority: 'low',
    reason: 'Architecture docs updated'
  }
};

/**
 * Find documentation that may be affected by a changed file
 * @param {string} filePath - Path to the changed file
 * @returns {Object} { docs: string[], priority: string, reason: string }
 */
export function findAffectedDocs(filePath) {
  // Normalize path
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check each pattern (longest match first for specificity)
  const patterns = Object.keys(FILE_TO_DOC_MAP).sort((a, b) => b.length - a.length);

  for (const pattern of patterns) {
    if (normalizedPath.includes(pattern) || normalizedPath.startsWith(pattern)) {
      return FILE_TO_DOC_MAP[pattern];
    }
  }

  // Check for README changes in folders
  if (normalizedPath.endsWith('README.md')) {
    return {
      docs: [],
      priority: 'low',
      reason: 'Folder README updated'
    };
  }

  // Check for doc changes
  if (normalizedPath.startsWith('docs/')) {
    return {
      docs: [],
      priority: 'low',
      reason: 'Documentation file updated'
    };
  }

  // Unknown file
  return {
    docs: [],
    priority: 'low',
    reason: 'No mapped documentation'
  };
}

/**
 * Categorize a git status code
 * @param {string} status - Git status code (M, A, D, R, etc.)
 * @returns {string} Human-readable status
 */
export function categorizeGitStatus(status) {
  const statusMap = {
    'M': 'Modified',
    'A': 'Added',
    'D': 'Deleted',
    'R': 'Renamed',
    'C': 'Copied',
    '?': 'Untracked',
    '!': 'Ignored',
    'U': 'Unmerged'
  };
  return statusMap[status.trim().charAt(0)] || 'Unknown';
}

export default {
  FILE_TO_DOC_MAP,
  findAffectedDocs,
  categorizeGitStatus
};
