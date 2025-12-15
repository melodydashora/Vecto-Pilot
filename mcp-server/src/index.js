/**
 * Vecto Pilot MCP Server
 *
 * Full-featured MCP (Model Context Protocol) server with 36+ tools
 * Provides Claude Desktop with complete access to:
 * - File operations (read, write, edit, delete, move, list)
 * - Search capabilities (grep, glob patterns)
 * - Shell execution (bash commands)
 * - Database operations (PostgreSQL)
 * - Web operations (fetch, search)
 * - Memory & context (eidolon integration)
 * - Project intelligence (code map, repo info)
 * - MCP diagnostics and monitoring
 */

import express from 'express';
import { fileTools } from './tools/file-tools.js';
import { searchTools } from './tools/search-tools.js';
import { shellTools } from './tools/shell-tools.js';
import { databaseTools } from './tools/database-tools.js';
import { webTools } from './tools/web-tools.js';
import { memoryTools } from './tools/memory-tools.js';
import { projectTools } from './tools/project-tools.js';
import { mcpTools } from './tools/mcp-tools.js';
import { aiTools } from './tools/ai-tools.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.MCP_PORT || 3001;
const REPO_ROOT = process.env.REPO_ROOT || process.cwd();

// All tools registry
const allTools = {
  // File Operations (8 tools)
  ...fileTools,
  // Search Operations (4 tools)
  ...searchTools,
  // Shell Operations (3 tools)
  ...shellTools,
  // Database Operations (4 tools)
  ...databaseTools,
  // Web Operations (3 tools)
  ...webTools,
  // Memory Operations (5 tools)
  ...memoryTools,
  // Project Intelligence (5 tools)
  ...projectTools,
  // MCP Diagnostics (3 tools)
  ...mcpTools,
  // AI Operations (4 tools)
  ...aiTools,
};

// Initialize tools with repo root
Object.values(allTools).forEach(tool => {
  if (tool.init) tool.init(REPO_ROOT);
});

// ============================================================================
// MCP Protocol Endpoints
// ============================================================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'vecto-pilot-mcp',
    version: '1.0.0',
    tools: Object.keys(allTools).length,
    repoRoot: REPO_ROOT,
    uptime: process.uptime()
  });
});

/**
 * List all available tools (MCP protocol)
 */
app.get('/mcp/tools', (req, res) => {
  const toolList = Object.entries(allTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: tool.category
  }));

  res.json({
    tools: toolList,
    count: toolList.length,
    categories: [...new Set(toolList.map(t => t.category))]
  });
});

/**
 * Execute a tool (MCP protocol)
 */
app.post('/mcp/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const params = req.body;

  const tool = allTools[toolName];
  if (!tool) {
    return res.status(404).json({
      error: 'tool_not_found',
      message: `Tool '${toolName}' not found`,
      available: Object.keys(allTools)
    });
  }

  try {
    console.log(`[MCP] Executing tool: ${toolName}`);
    const result = await tool.execute(params, REPO_ROOT);
    res.json({ success: true, result });
  } catch (err) {
    console.error(`[MCP] Tool error (${toolName}):`, err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      tool: toolName
    });
  }
});

/**
 * Batch execute multiple tools
 */
app.post('/mcp/batch', async (req, res) => {
  const { operations } = req.body;

  if (!Array.isArray(operations)) {
    return res.status(400).json({ error: 'operations must be an array' });
  }

  const results = await Promise.all(
    operations.map(async (op) => {
      const tool = allTools[op.tool];
      if (!tool) {
        return { tool: op.tool, error: 'tool_not_found' };
      }
      try {
        const result = await tool.execute(op.params, REPO_ROOT);
        return { tool: op.tool, success: true, result };
      } catch (err) {
        return { tool: op.tool, success: false, error: err.message };
      }
    })
  );

  res.json({ results });
});

/**
 * Server info and capabilities
 */
app.get('/mcp', (req, res) => {
  res.json({
    name: 'vecto-pilot-mcp',
    version: '1.0.0',
    protocol: 'mcp-1.0',

    // IMPORTANT: Guidance for Claude Desktop
    guidance: {
      warning: "⚠️ THIS CODEBASE CAN BREAK EASILY",
      instruction: "ALWAYS call get_guidelines tool FIRST before making any changes!",
      workflow: [
        "1. Call get_guidelines to understand critical rules",
        "2. Use read_file and grep_search to understand code before changing",
        "3. Make small, focused changes",
        "4. Run npm run typecheck to validate"
      ],
      remember: "AI-generated coordinates are unreliable - always use Google Geocoding API"
    },

    capabilities: {
      tools: true,
      batch: true,
      streaming: false
    },
    toolCount: Object.keys(allTools).length,
    categories: {
      file: 8,
      search: 4,
      shell: 3,
      database: 4,
      web: 3,
      memory: 5,
      project: 6,  // +1 for get_guidelines
      mcp: 3,
      ai: 4
    },
    repoRoot: REPO_ROOT
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VECTO PILOT MCP SERVER');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Port:      ${PORT}`);
  console.log(`  Repo Root: ${REPO_ROOT}`);
  console.log(`  Tools:     ${Object.keys(allTools).length}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /health         - Health check`);
  console.log(`  GET  /mcp            - Server info`);
  console.log(`  GET  /mcp/tools      - List all tools`);
  console.log(`  POST /mcp/tools/:name - Execute tool`);
  console.log(`  POST /mcp/batch      - Batch execute`);
  console.log('');
  console.log('Tools by category:');
  Object.entries(allTools).reduce((acc, [name, tool]) => {
    acc[tool.category] = acc[tool.category] || [];
    acc[tool.category].push(name);
    return acc;
  }, {});
  console.log('═══════════════════════════════════════════════════════════════');
});
