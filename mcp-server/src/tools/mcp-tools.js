/**
 * MCP Diagnostics Tools (3 tools)
 *
 * mcp_status, mcp_test, mcp_logs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
let repoRoot = process.cwd();

// Request/response log buffer
const requestLog = [];
const MAX_LOG_ENTRIES = 1000;

export function logRequest(req, res, duration) {
  requestLog.push({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    status: res.statusCode,
    duration_ms: duration
  });
  if (requestLog.length > MAX_LOG_ENTRIES) {
    requestLog.shift();
  }
}

export const mcpTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // mcp_status - Get MCP server status and health
  // ─────────────────────────────────────────────────────────────────────────
  mcp_status: {
    category: 'mcp',
    description: 'Get MCP server status, health, and configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        include_config: { type: 'boolean', default: true },
        test_connections: { type: 'boolean', default: false }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ include_config = true, test_connections = false }) {
      const status = {
        server: 'vecto-pilot-mcp',
        version: '1.0.0',
        status: 'healthy',
        uptime_seconds: process.uptime(),
        memory: {
          used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        repo_root: repoRoot,
        timestamp: new Date().toISOString()
      };

      if (include_config) {
        // Check for MCP config files
        const configFiles = [
          '.replit-assistant-override.json',
          'mcp-config.json',
          'claude-desktop-config.json'
        ];

        status.config_files = [];
        for (const file of configFiles) {
          try {
            await fs.access(path.join(repoRoot, file));
            status.config_files.push({ file, exists: true });
          } catch {
            status.config_files.push({ file, exists: false });
          }
        }
      }

      if (test_connections) {
        status.connections = [];

        // Test database
        if (process.env.DATABASE_URL) {
          try {
            const { Pool } = await import('pg');
            const pool = new Pool({ connectionString: process.env.DATABASE_URL });
            await pool.query('SELECT 1');
            await pool.end();
            status.connections.push({ name: 'database', status: 'connected' });
          } catch (err) {
            status.connections.push({ name: 'database', status: 'error', error: err.message });
          }
        }

        // Test main server
        const mainPort = process.env.PORT || 5000;
        try {
          const res = await fetch(`http://localhost:${mainPort}/health`);
          status.connections.push({
            name: 'main_server',
            status: res.ok ? 'connected' : 'error',
            port: mainPort
          });
        } catch {
          status.connections.push({ name: 'main_server', status: 'not_running', port: mainPort });
        }
      }

      return status;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // mcp_test - Test MCP tool functionality
  // ─────────────────────────────────────────────────────────────────────────
  mcp_test: {
    category: 'mcp',
    description: 'Test MCP tools and verify they work correctly.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Specific tool to test (or all)' },
        quick: { type: 'boolean', default: true, description: 'Quick test only' }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ tool_name, quick = true }) {
      const tests = [];

      // Define simple tests for each tool category
      const toolTests = {
        read_file: async () => {
          const result = await fs.readFile(path.join(repoRoot, 'package.json'), 'utf-8');
          return { success: !!result, bytes: result.length };
        },
        list_directory: async () => {
          const entries = await fs.readdir(repoRoot);
          return { success: entries.length > 0, count: entries.length };
        },
        grep_search: async () => {
          const { stdout } = await execAsync(`rg -c "import" "${repoRoot}" --glob "*.js" | head -5`);
          return { success: true, matches: stdout.trim().split('\n').length };
        },
        run_command: async () => {
          const { stdout } = await execAsync('echo "test"');
          return { success: stdout.trim() === 'test' };
        }
      };

      if (tool_name && toolTests[tool_name]) {
        try {
          const result = await toolTests[tool_name]();
          tests.push({ tool: tool_name, ...result });
        } catch (err) {
          tests.push({ tool: tool_name, success: false, error: err.message });
        }
      } else if (!tool_name || tool_name === 'all') {
        // Run all quick tests
        for (const [name, testFn] of Object.entries(toolTests)) {
          if (!quick || ['read_file', 'list_directory', 'run_command'].includes(name)) {
            try {
              const result = await testFn();
              tests.push({ tool: name, ...result });
            } catch (err) {
              tests.push({ tool: name, success: false, error: err.message });
            }
          }
        }
      }

      const passed = tests.filter(t => t.success).length;
      const failed = tests.filter(t => !t.success).length;

      return {
        summary: { total: tests.length, passed, failed },
        tests
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // mcp_logs - Get MCP server logs and request history
  // ─────────────────────────────────────────────────────────────────────────
  mcp_logs: {
    category: 'mcp',
    description: 'Get MCP server logs and request history.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['requests', 'errors', 'all'],
          default: 'requests'
        },
        limit: { type: 'number', default: 50 },
        since: { type: 'string', description: 'ISO timestamp to filter from' }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ type = 'requests', limit = 50, since }) {
      let logs = [...requestLog];

      // Filter by time
      if (since) {
        const sinceDate = new Date(since);
        logs = logs.filter(l => new Date(l.timestamp) >= sinceDate);
      }

      // Filter by type
      if (type === 'errors') {
        logs = logs.filter(l => l.status >= 400);
      }

      // Limit and reverse (newest first)
      logs = logs.slice(-limit).reverse();

      // Calculate stats
      const stats = {
        total_requests: requestLog.length,
        errors: requestLog.filter(l => l.status >= 400).length,
        avg_duration_ms: requestLog.length > 0
          ? Math.round(requestLog.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / requestLog.length)
          : 0
      };

      return {
        logs,
        stats,
        log_buffer_size: requestLog.length,
        max_buffer_size: MAX_LOG_ENTRIES
      };
    }
  }
};
