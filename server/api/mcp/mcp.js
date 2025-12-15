/**
 * MCP (Model Context Protocol) Router
 *
 * Provides Claude Desktop with full repo access through 39 tools.
 * Integrated into gateway-server.js for unified access.
 */

import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';

const router = express.Router();

// Repo root - workspace directory
const REPO_ROOT = process.env.REPO_ROOT || '/home/runner/workspace';

// Request logging for MCP
const requestLog = [];
const MAX_LOG_SIZE = 100;

function logRequest(tool, params, result, duration) {
  requestLog.unshift({
    tool,
    params: JSON.stringify(params).slice(0, 200),
    success: !result.error,
    duration,
    timestamp: new Date().toISOString()
  });
  if (requestLog.length > MAX_LOG_SIZE) requestLog.pop();
}

// ============================================================================
// Tool Definitions
// ============================================================================

const tools = {
  // -------------------------------------------------------------------------
  // FILE OPERATIONS (8 tools)
  // -------------------------------------------------------------------------

  read_file: {
    category: 'file',
    description: 'Read file contents with optional line range',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to repo root' },
        offset: { type: 'number', description: 'Starting line (1-indexed)' },
        limit: { type: 'number', description: 'Number of lines to read' }
      },
      required: ['file_path']
    },
    async execute({ file_path, offset = 1, limit }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(1, offset) - 1;
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);
      return {
        content: selectedLines.map((line, i) => `${startLine + i + 1}: ${line}`).join('\n'),
        totalLines: lines.length,
        range: { start: startLine + 1, end: Math.min(endLine, lines.length) }
      };
    }
  },

  write_file: {
    category: 'file',
    description: 'Create or overwrite a file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to repo root' },
        content: { type: 'string', description: 'File content' }
      },
      required: ['file_path', 'content']
    },
    async execute({ file_path, content }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, path: file_path, bytes: content.length };
    }
  },

  edit_file: {
    category: 'file',
    description: 'Find and replace text in a file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to repo root' },
        old_string: { type: 'string', description: 'Text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences' }
      },
      required: ['file_path', 'old_string', 'new_string']
    },
    async execute({ file_path, old_string, new_string, replace_all = false }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      let content = await fs.readFile(fullPath, 'utf-8');
      const count = (content.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (count === 0) throw new Error(`String not found in file`);
      if (replace_all) {
        content = content.replaceAll(old_string, new_string);
      } else {
        content = content.replace(old_string, new_string);
      }
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, replacements: replace_all ? count : 1 };
    }
  },

  delete_file: {
    category: 'file',
    description: 'Delete a file or directory',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to repo root' },
        recursive: { type: 'boolean', description: 'Delete directories recursively' }
      },
      required: ['file_path']
    },
    async execute({ file_path, recursive = false }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      await fs.rm(fullPath, { recursive });
      return { success: true, deleted: file_path };
    }
  },

  move_file: {
    category: 'file',
    description: 'Move or rename a file',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' }
      },
      required: ['source', 'destination']
    },
    async execute({ source, destination }) {
      const srcPath = path.join(REPO_ROOT, source);
      const destPath = path.join(REPO_ROOT, destination);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.rename(srcPath, destPath);
      return { success: true, from: source, to: destination };
    }
  },

  copy_file: {
    category: 'file',
    description: 'Copy a file',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' }
      },
      required: ['source', 'destination']
    },
    async execute({ source, destination }) {
      const srcPath = path.join(REPO_ROOT, source);
      const destPath = path.join(REPO_ROOT, destination);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
      return { success: true, from: source, to: destination };
    }
  },

  list_directory: {
    category: 'file',
    description: 'List directory contents with glob pattern support',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        pattern: { type: 'string', description: 'Glob pattern (e.g., *.js)' },
        recursive: { type: 'boolean', description: 'List recursively' }
      }
    },
    async execute({ path: dirPath = '.', pattern, recursive = false }) {
      const fullPath = path.join(REPO_ROOT, dirPath);

      if (pattern && recursive) {
        // Use find with pattern
        const cmd = `find ${fullPath} -name "${pattern}" -type f 2>/dev/null | head -100`;
        const output = execSync(cmd, { encoding: 'utf-8' });
        const files = output.trim().split('\n').filter(Boolean);
        return { files: files.map(f => f.replace(REPO_ROOT + '/', '')), count: files.length };
      }

      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file'
      }));

      if (pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return { items: items.filter(i => regex.test(i.name)), count: items.length };
      }

      return { items, count: items.length };
    }
  },

  file_info: {
    category: 'file',
    description: 'Get detailed file information',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path relative to repo root' }
      },
      required: ['file_path']
    },
    async execute({ file_path }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const stat = await fs.stat(fullPath);
      return {
        path: file_path,
        size: stat.size,
        isDirectory: stat.isDirectory(),
        created: stat.birthtime,
        modified: stat.mtime,
        permissions: stat.mode.toString(8)
      };
    }
  },

  // -------------------------------------------------------------------------
  // SEARCH OPERATIONS (4 tools)
  // -------------------------------------------------------------------------

  grep_search: {
    category: 'search',
    description: 'Search file contents with regex (ripgrep)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search' },
        path: { type: 'string', description: 'Directory to search' },
        file_type: { type: 'string', description: 'File extension filter (js, ts, etc.)' },
        context_lines: { type: 'number', description: 'Lines of context around matches' }
      },
      required: ['pattern']
    },
    async execute({ pattern, path: searchPath = '.', file_type, context_lines = 0 }) {
      const fullPath = path.join(REPO_ROOT, searchPath);
      let cmd = `rg --json "${pattern}" "${fullPath}"`;
      if (file_type) cmd += ` -t ${file_type}`;
      if (context_lines) cmd += ` -C ${context_lines}`;
      cmd += ' 2>/dev/null | head -50';

      try {
        const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        const matches = output.trim().split('\n')
          .filter(Boolean)
          .map(line => {
            try {
              return JSON.parse(line);
            } catch { return null; }
          })
          .filter(m => m && m.type === 'match')
          .map(m => ({
            file: m.data.path.text.replace(REPO_ROOT + '/', ''),
            line: m.data.line_number,
            text: m.data.lines.text.trim()
          }));
        return { matches, count: matches.length };
      } catch {
        return { matches: [], count: 0 };
      }
    }
  },

  glob_find: {
    category: 'search',
    description: 'Find files by glob pattern',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.js)' },
        path: { type: 'string', description: 'Base directory' }
      },
      required: ['pattern']
    },
    async execute({ pattern, path: basePath = '.' }) {
      const fullPath = path.join(REPO_ROOT, basePath);
      const cmd = `find ${fullPath} -name "${pattern.replace('**/', '')}" -type f 2>/dev/null | head -100`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      const files = output.trim().split('\n').filter(Boolean).map(f => f.replace(REPO_ROOT + '/', ''));
      return { files, count: files.length };
    }
  },

  search_replace: {
    category: 'search',
    description: 'Search and replace across multiple files',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        replacement: { type: 'string', description: 'Replacement text' },
        path: { type: 'string', description: 'Directory to search' },
        file_type: { type: 'string', description: 'File extension filter' },
        dry_run: { type: 'boolean', description: 'Preview without changes' }
      },
      required: ['pattern', 'replacement']
    },
    async execute({ pattern, replacement, path: searchPath = '.', file_type, dry_run = true }) {
      const fullPath = path.join(REPO_ROOT, searchPath);
      const typeFlag = file_type ? `-t ${file_type}` : '';

      // Find files with matches
      const findCmd = `rg -l "${pattern}" "${fullPath}" ${typeFlag} 2>/dev/null`;
      let files;
      try {
        files = execSync(findCmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
      } catch {
        return { files: [], changes: 0, dry_run };
      }

      if (dry_run) {
        return {
          files: files.map(f => f.replace(REPO_ROOT + '/', '')),
          changes: files.length,
          dry_run: true,
          message: 'Use dry_run: false to apply changes'
        };
      }

      // Apply changes
      let changes = 0;
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const newContent = content.replaceAll(pattern, replacement);
        if (content !== newContent) {
          await fs.writeFile(file, newContent, 'utf-8');
          changes++;
        }
      }

      return { files: files.map(f => f.replace(REPO_ROOT + '/', '')), changes, dry_run: false };
    }
  },

  search_symbols: {
    category: 'search',
    description: 'Find functions, classes, and exports',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['function', 'class', 'export', 'import', 'all'], description: 'Symbol type' },
        name: { type: 'string', description: 'Symbol name pattern' },
        path: { type: 'string', description: 'Directory to search' }
      }
    },
    async execute({ type = 'all', name, path: searchPath = '.' }) {
      const fullPath = path.join(REPO_ROOT, searchPath);
      const patterns = {
        function: 'function\\s+\\w+|const\\s+\\w+\\s*=\\s*(async\\s+)?\\([^)]*\\)\\s*=>',
        class: 'class\\s+\\w+',
        export: 'export\\s+(default\\s+)?(function|class|const|let|var)',
        import: 'import\\s+.*\\s+from'
      };

      const pattern = type === 'all'
        ? Object.values(patterns).join('|')
        : patterns[type] || patterns.function;

      const cmd = `rg "${pattern}" "${fullPath}" -t js -t ts --json 2>/dev/null | head -100`;

      try {
        const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        const symbols = output.trim().split('\n')
          .filter(Boolean)
          .map(line => {
            try { return JSON.parse(line); } catch { return null; }
          })
          .filter(m => m && m.type === 'match')
          .map(m => ({
            file: m.data.path.text.replace(REPO_ROOT + '/', ''),
            line: m.data.line_number,
            symbol: m.data.lines.text.trim().slice(0, 100)
          }));

        if (name) {
          return { symbols: symbols.filter(s => s.symbol.includes(name)), count: symbols.length };
        }
        return { symbols, count: symbols.length };
      } catch {
        return { symbols: [], count: 0 };
      }
    }
  },

  // -------------------------------------------------------------------------
  // SHELL OPERATIONS (3 tools)
  // -------------------------------------------------------------------------

  run_command: {
    category: 'shell',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' }
      },
      required: ['command']
    },
    async execute({ command, cwd = REPO_ROOT, timeout = 30000 }) {
      return new Promise((resolve) => {
        const proc = spawn('bash', ['-c', command], {
          cwd: path.join(REPO_ROOT, cwd === REPO_ROOT ? '.' : cwd),
          timeout
        });

        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);

        proc.on('close', code => {
          resolve({
            stdout: stdout.slice(0, 10000),
            stderr: stderr.slice(0, 2000),
            exitCode: code,
            success: code === 0
          });
        });

        proc.on('error', err => {
          resolve({ error: err.message, success: false });
        });
      });
    }
  },

  run_script: {
    category: 'shell',
    description: 'Run npm/node/python scripts',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['npm', 'node', 'python'], description: 'Script type' },
        script: { type: 'string', description: 'Script name or file' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments' }
      },
      required: ['type', 'script']
    },
    async execute({ type, script, args = [] }) {
      const commands = {
        npm: `npm run ${script} ${args.join(' ')}`,
        node: `node ${script} ${args.join(' ')}`,
        python: `python ${script} ${args.join(' ')}`
      };
      return tools.run_command.execute({ command: commands[type] });
    }
  },

  get_process_info: {
    category: 'shell',
    description: 'Get current process information',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return {
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cwd: process.cwd(),
        nodeVersion: process.version,
        platform: process.platform
      };
    }
  },

  // -------------------------------------------------------------------------
  // DATABASE OPERATIONS (4 tools)
  // -------------------------------------------------------------------------

  sql_query: {
    category: 'database',
    description: 'Execute SELECT queries (read-only)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT query' },
        limit: { type: 'number', description: 'Result limit' }
      },
      required: ['query']
    },
    async execute({ query, limit = 100 }) {
      if (!query.trim().toLowerCase().startsWith('select')) {
        throw new Error('Only SELECT queries allowed. Use sql_execute for modifications.');
      }
      const limitedQuery = query.includes('LIMIT') ? query : `${query} LIMIT ${limit}`;
      const result = await db.execute(sql.raw(limitedQuery));
      return { rows: result.rows, count: result.rows.length };
    }
  },

  sql_execute: {
    category: 'database',
    description: 'Execute INSERT/UPDATE/DELETE queries',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query' }
      },
      required: ['query']
    },
    async execute({ query }) {
      const lower = query.trim().toLowerCase();
      if (lower.startsWith('select')) {
        throw new Error('Use sql_query for SELECT queries');
      }
      if (lower.includes('drop') || lower.includes('truncate')) {
        throw new Error('DROP and TRUNCATE not allowed');
      }
      const result = await db.execute(sql.raw(query));
      return { success: true, rowCount: result.rowCount };
    }
  },

  db_schema: {
    category: 'database',
    description: 'Get table schema',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' }
      },
      required: ['table']
    },
    async execute({ table }) {
      const result = await db.execute(sql.raw(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = '${table}'
        ORDER BY ordinal_position
      `));
      return { table, columns: result.rows };
    }
  },

  db_tables: {
    category: 'database',
    description: 'List all database tables',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const result = await db.execute(sql.raw(`
        SELECT table_name,
               (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as column_count
        FROM information_schema.tables t
        WHERE table_schema = 'public'
        ORDER BY table_name
      `));
      return { tables: result.rows };
    }
  },

  // -------------------------------------------------------------------------
  // PROJECT INTELLIGENCE (6 tools)
  // -------------------------------------------------------------------------

  get_guidelines: {
    category: 'project',
    description: 'IMPORTANT: Call this FIRST! Get critical rules and warnings before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['all', 'models', 'location', 'database', 'workflow'], description: 'Specific section' }
      }
    },
    async execute({ section = 'all' }) {
      const guidelines = {
        warning: "THIS CODEBASE CAN BREAK EASILY - Use tools to understand before making changes!",
        critical_rules: {
          model_parameters: {
            'gpt-5.2': { correct: '{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }', wrong: '{ reasoning: { effort: "medium" } } or { temperature: 0.7 }' },
            'gemini-3-pro': { correct: '{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }' }
          },
          location_data: {
            rule: "GPS-first: Never use IP fallback or default locations",
            coordinates: "ALWAYS use Google Geocoding API - AI models hallucinate coordinates"
          },
          database: {
            rule: "All data must link to snapshot_id",
            sorting: "Use created_at DESC (newest first)"
          }
        },
        safe_workflow: [
          "1. Call get_guidelines (this tool) FIRST",
          "2. Use read_file to understand code before changing",
          "3. Use grep_search to find all usages of functions you'll modify",
          "4. Make small, focused changes",
          "5. Run: npm run typecheck to validate",
          "6. Use ai_analyze to check for issues"
        ],
        key_files: [
          "/CLAUDE.md - Project overview and critical rules",
          "/ARCHITECTURE.md - System architecture",
          "/LESSONS_LEARNED.md - Past mistakes to avoid",
          "/docs/architecture/ai-pipeline.md - AI model details"
        ],
        remember: [
          "Understand first, change second",
          "Small changes, not big rewrites",
          "Test always with npm run typecheck",
          "AI-generated coordinates are unreliable",
          "Ask the user when unsure"
        ]
      };

      if (section !== 'all' && guidelines.critical_rules[section]) {
        return { [section]: guidelines.critical_rules[section], workflow: guidelines.safe_workflow };
      }
      return guidelines;
    }
  },

  get_repo_info: {
    category: 'project',
    description: 'Get project overview and structure',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      let packageJson = {};
      try {
        packageJson = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
      } catch {}

      const gitInfo = {};
      try {
        gitInfo.branch = execSync('git branch --show-current', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
        gitInfo.lastCommit = execSync('git log -1 --format="%h %s"', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
      } catch {}

      return {
        name: packageJson.name || 'vecto-pilot',
        description: packageJson.description,
        version: packageJson.version,
        scripts: Object.keys(packageJson.scripts || {}),
        dependencies: Object.keys(packageJson.dependencies || {}).length,
        devDependencies: Object.keys(packageJson.devDependencies || {}).length,
        git: gitInfo,
        structure: {
          server: 'Backend API routes and business logic',
          client: 'React frontend with Vite',
          shared: 'Shared schema and utilities',
          docs: 'Architecture and API documentation'
        }
      };
    }
  },

  code_map: {
    category: 'project',
    description: 'Map code structure of a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to map' },
        depth: { type: 'number', description: 'Max depth' }
      }
    },
    async execute({ path: dirPath = '.', depth = 2 }) {
      const fullPath = path.join(REPO_ROOT, dirPath);
      const cmd = `find ${fullPath} -maxdepth ${depth} -type f \\( -name "*.js" -o -name "*.ts" -o -name "*.tsx" \\) | head -50`;
      const files = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);

      const structure = {};
      for (const file of files) {
        const rel = file.replace(REPO_ROOT + '/', '');
        const parts = rel.split('/');
        let current = structure;
        for (let i = 0; i < parts.length - 1; i++) {
          current[parts[i]] = current[parts[i]] || {};
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = 'file';
      }

      return { path: dirPath, structure, fileCount: files.length };
    }
  },

  dependency_graph: {
    category: 'project',
    description: 'Analyze file dependencies',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to analyze' }
      },
      required: ['file_path']
    },
    async execute({ file_path }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');

      const imports = [];
      const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      return {
        file: file_path,
        imports,
        importCount: imports.length,
        internal: imports.filter(i => i.startsWith('.') || i.startsWith('/')),
        external: imports.filter(i => !i.startsWith('.') && !i.startsWith('/'))
      };
    }
  },

  todo_list: {
    category: 'project',
    description: 'Find TODO, FIXME, HACK comments',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search' },
        type: { type: 'string', enum: ['TODO', 'FIXME', 'HACK', 'all'], description: 'Comment type' }
      }
    },
    async execute({ path: searchPath = '.', type = 'all' }) {
      const pattern = type === 'all' ? 'TODO|FIXME|HACK' : type;
      const fullPath = path.join(REPO_ROOT, searchPath);
      const cmd = `rg "(${pattern}):" "${fullPath}" -t js -t ts --json 2>/dev/null | head -50`;

      try {
        const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        const todos = output.trim().split('\n')
          .filter(Boolean)
          .map(line => { try { return JSON.parse(line); } catch { return null; } })
          .filter(m => m && m.type === 'match')
          .map(m => ({
            file: m.data.path.text.replace(REPO_ROOT + '/', ''),
            line: m.data.line_number,
            text: m.data.lines.text.trim()
          }));
        return { todos, count: todos.length };
      } catch {
        return { todos: [], count: 0 };
      }
    }
  },

  project_stats: {
    category: 'project',
    description: 'Get project statistics',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const counts = {};
      const extensions = ['js', 'ts', 'tsx', 'json', 'md', 'css'];

      for (const ext of extensions) {
        try {
          const output = execSync(`find ${REPO_ROOT} -name "*.${ext}" -type f | wc -l`, { encoding: 'utf-8' });
          counts[ext] = parseInt(output.trim(), 10);
        } catch {
          counts[ext] = 0;
        }
      }

      let totalLines = 0;
      try {
        const output = execSync(`find ${REPO_ROOT} -name "*.js" -o -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | tail -1`, { encoding: 'utf-8' });
        totalLines = parseInt(output.trim().split(' ')[0], 10) || 0;
      } catch {}

      return { fileCounts: counts, totalCodeLines: totalLines };
    }
  },

  // -------------------------------------------------------------------------
  // MCP DIAGNOSTICS (4 tools)
  // -------------------------------------------------------------------------

  mcp_status: {
    category: 'mcp',
    description: 'Get MCP server status',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      return {
        status: 'healthy',
        server: 'vecto-pilot-mcp',
        version: '1.0.0',
        tools: Object.keys(tools).length,
        categories: [...new Set(Object.values(tools).map(t => t.category))],
        uptime: process.uptime(),
        repoRoot: REPO_ROOT
      };
    }
  },

  mcp_test: {
    category: 'mcp',
    description: 'Test a tool with sample input',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool name to test' }
      },
      required: ['tool']
    },
    async execute({ tool: toolName }) {
      const tool = tools[toolName];
      if (!tool) {
        return { error: `Tool '${toolName}' not found`, available: Object.keys(tools) };
      }
      return {
        tool: toolName,
        category: tool.category,
        description: tool.description,
        inputSchema: tool.inputSchema,
        status: 'available'
      };
    }
  },

  mcp_logs: {
    category: 'mcp',
    description: 'View recent MCP request history',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of logs to return' }
      }
    },
    async execute({ limit = 20 }) {
      return { logs: requestLog.slice(0, limit), total: requestLog.length };
    }
  },

  analyze_changes: {
    category: 'mcp',
    description: 'Analyze repo changes and flag documentation that may need updating',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    async execute() {
      try {
        const { runAnalysis } = await import('../../jobs/change-analyzer-job.js');
        const result = await runAnalysis();
        return {
          success: result.success,
          changesFound: result.changesFound || 0,
          highPriority: result.highPriority || 0,
          mediumPriority: result.mediumPriority || 0,
          lowPriority: result.lowPriority || 0,
          duration: result.duration,
          message: result.success
            ? `Analysis complete. Check docs/review-queue/pending.md for findings.`
            : `Analysis failed: ${result.error}`
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  },

  // -------------------------------------------------------------------------
  // AI OPERATIONS (4 tools)
  // -------------------------------------------------------------------------

  ai_analyze: {
    category: 'ai',
    description: 'Analyze code for potential issues',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to analyze' },
        type: { type: 'string', enum: ['security', 'performance', 'error_handling', 'all'], description: 'Analysis type' }
      },
      required: ['file_path']
    },
    async execute({ file_path, type = 'all' }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');

      const issues = [];

      // Security checks
      if (type === 'all' || type === 'security') {
        if (content.includes('eval(')) issues.push({ type: 'security', message: 'eval() usage detected', severity: 'high' });
        if (/innerHTML\s*=/.test(content)) issues.push({ type: 'security', message: 'innerHTML assignment (XSS risk)', severity: 'medium' });
        if (/\$\{.*\}/.test(content) && content.includes('sql')) issues.push({ type: 'security', message: 'Potential SQL injection', severity: 'high' });
      }

      // Performance checks
      if (type === 'all' || type === 'performance') {
        if (/\.forEach\(.*await/.test(content)) issues.push({ type: 'performance', message: 'await inside forEach (use for...of)', severity: 'medium' });
        if (content.includes('console.log') && !file_path.includes('test')) issues.push({ type: 'performance', message: 'console.log in production code', severity: 'low' });
      }

      // Error handling checks
      if (type === 'all' || type === 'error_handling') {
        const tryCount = (content.match(/try\s*{/g) || []).length;
        const catchCount = (content.match(/catch\s*\(/g) || []).length;
        if (tryCount !== catchCount) issues.push({ type: 'error_handling', message: 'Mismatched try/catch blocks', severity: 'medium' });
        if (content.includes('.catch(() => {})')) issues.push({ type: 'error_handling', message: 'Empty catch block', severity: 'medium' });
      }

      return { file: file_path, issues, issueCount: issues.length };
    }
  },

  ai_suggest: {
    category: 'ai',
    description: 'Suggest improvements for code',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to analyze' }
      },
      required: ['file_path']
    },
    async execute({ file_path }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');

      const suggestions = [];

      // Common improvements
      if (content.includes('var ')) suggestions.push('Replace var with const/let');
      if (/function\s+\w+\s*\(/.test(content) && content.includes('=>')) suggestions.push('Consider consistent arrow function usage');
      if (content.length > 500 && !content.includes('/**')) suggestions.push('Add JSDoc comments for documentation');
      if (/catch\s*\(\s*e\s*\)\s*{\s*}/.test(content)) suggestions.push('Handle or log caught errors');
      if (content.includes('TODO:') || content.includes('FIXME:')) suggestions.push('Address TODO/FIXME comments');

      return { file: file_path, suggestions, lines: content.split('\n').length };
    }
  },

  ai_explain: {
    category: 'ai',
    description: 'Get structural explanation of a file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to explain' }
      },
      required: ['file_path']
    },
    async execute({ file_path }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');

      const exports = (content.match(/export\s+(default\s+)?(function|class|const|let)\s+(\w+)/g) || []);
      const imports = (content.match(/import\s+.*\s+from\s+['"][^'"]+['"]/g) || []);
      const functions = (content.match(/(?:function|const|let)\s+(\w+)\s*(?:=\s*(?:async\s+)?\([^)]*\)\s*=>|\([^)]*\)\s*{)/g) || []);

      return {
        file: file_path,
        lines: content.split('\n').length,
        imports: imports.length,
        exports: exports.map(e => e.replace(/export\s+(default\s+)?/, '').trim()),
        functions: functions.slice(0, 20).map(f => f.split(/[=(]/)[0].replace(/^(function|const|let)\s+/, '').trim()),
        hasTests: file_path.includes('test') || file_path.includes('spec'),
        isComponent: file_path.endsWith('.tsx') && content.includes('return (')
      };
    }
  },

  ai_refactor: {
    category: 'ai',
    description: 'Identify refactoring opportunities',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to analyze' }
      },
      required: ['file_path']
    },
    async execute({ file_path }) {
      const fullPath = path.join(REPO_ROOT, file_path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      const opportunities = [];

      // Long file
      if (lines.length > 300) opportunities.push({ type: 'split', message: `File has ${lines.length} lines - consider splitting` });

      // Duplicate code detection (simple)
      const codeBlocks = {};
      for (let i = 0; i < lines.length - 5; i++) {
        const block = lines.slice(i, i + 5).join('\n').trim();
        if (block.length > 50) {
          codeBlocks[block] = (codeBlocks[block] || 0) + 1;
        }
      }
      const duplicates = Object.entries(codeBlocks).filter(([, count]) => count > 1).length;
      if (duplicates > 0) opportunities.push({ type: 'duplicate', message: `Found ${duplicates} potentially duplicate code blocks` });

      // Deep nesting
      let maxIndent = 0;
      for (const line of lines) {
        const indent = line.match(/^(\s*)/)[1].length;
        maxIndent = Math.max(maxIndent, indent);
      }
      if (maxIndent > 16) opportunities.push({ type: 'nesting', message: `Deep nesting detected (${maxIndent / 2} levels) - consider extracting functions` });

      return { file: file_path, opportunities, lineCount: lines.length };
    }
  }
};

// ============================================================================
// MCP Endpoints
// ============================================================================

/**
 * Server info and capabilities
 */
router.get('/', (req, res) => {
  res.json({
    name: 'vecto-pilot-mcp',
    version: '1.0.0',
    protocol: 'mcp-1.0',

    guidance: {
      warning: "THIS CODEBASE CAN BREAK EASILY",
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
    toolCount: Object.keys(tools).length,
    categories: {
      file: 8,
      search: 4,
      shell: 3,
      database: 4,
      project: 6,
      mcp: 3,
      ai: 4
    },
    repoRoot: REPO_ROOT
  });
});

/**
 * List all available tools
 */
router.get('/tools', (req, res) => {
  const toolList = Object.entries(tools).map(([name, tool]) => ({
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
 * Execute a tool
 */
router.post('/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const params = req.body;
  const startTime = Date.now();

  const tool = tools[toolName];
  if (!tool) {
    return res.status(404).json({
      error: 'tool_not_found',
      message: `Tool '${toolName}' not found`,
      available: Object.keys(tools)
    });
  }

  try {
    console.log(`[MCP] Executing tool: ${toolName}`);
    const result = await tool.execute(params);
    const duration = Date.now() - startTime;
    logRequest(toolName, params, result, duration);
    res.json({ success: true, result, duration });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] Tool error (${toolName}):`, err.message);
    logRequest(toolName, params, { error: err.message }, duration);
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
router.post('/batch', async (req, res) => {
  const { operations } = req.body;

  if (!Array.isArray(operations)) {
    return res.status(400).json({ error: 'operations must be an array' });
  }

  const results = await Promise.all(
    operations.map(async (op) => {
      const tool = tools[op.tool];
      if (!tool) {
        return { tool: op.tool, error: 'tool_not_found' };
      }
      try {
        const result = await tool.execute(op.params || {});
        return { tool: op.tool, success: true, result };
      } catch (err) {
        return { tool: op.tool, success: false, error: err.message };
      }
    })
  );

  res.json({ results });
});

export default router;
