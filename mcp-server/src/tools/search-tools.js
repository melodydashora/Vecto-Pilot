/**
 * Search Tools (4 tools)
 *
 * grep_search, glob_find, search_replace, search_symbols
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
let repoRoot = process.cwd();

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

export const searchTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // grep_search - Search file contents with regex
  // ─────────────────────────────────────────────────────────────────────────
  grep_search: {
    category: 'search',
    description: 'Search file contents using regex patterns (ripgrep-powered).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search' },
        path: { type: 'string', description: 'Directory or file to search' },
        file_type: { type: 'string', description: 'File type filter (js, ts, py, etc.)' },
        case_insensitive: { type: 'boolean', default: false },
        context_lines: { type: 'number', default: 0, description: 'Lines of context before/after' },
        max_results: { type: 'number', default: 100 },
        files_only: { type: 'boolean', default: false, description: 'Return only file names' }
      },
      required: ['pattern']
    },
    init(root) { repoRoot = root; },
    async execute({ pattern, path: searchPath, file_type, case_insensitive, context_lines = 0, max_results = 100, files_only = false }) {
      const targetPath = searchPath ? resolvePath(searchPath) : repoRoot;

      // Build ripgrep command
      let cmd = 'rg';
      if (case_insensitive) cmd += ' -i';
      if (context_lines > 0) cmd += ` -C ${context_lines}`;
      if (file_type) cmd += ` -t ${file_type}`;
      if (files_only) cmd += ' -l';
      cmd += ` -n --max-count ${max_results}`;
      cmd += ` "${pattern.replace(/"/g, '\\"')}"`;
      cmd += ` "${targetPath}"`;

      try {
        const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
        const lines = stdout.trim().split('\n').filter(Boolean);

        if (files_only) {
          return {
            pattern,
            matches: lines,
            count: lines.length
          };
        }

        // Parse ripgrep output
        const matches = lines.map(line => {
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            return {
              file: match[1],
              line: parseInt(match[2]),
              content: match[3]
            };
          }
          return { raw: line };
        });

        return {
          pattern,
          matches,
          count: matches.length
        };
      } catch (err) {
        // ripgrep returns exit code 1 for no matches
        if (err.code === 1) {
          return { pattern, matches: [], count: 0 };
        }
        throw err;
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // glob_find - Find files by pattern
  // ─────────────────────────────────────────────────────────────────────────
  glob_find: {
    category: 'search',
    description: 'Find files matching glob patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.js)' },
        path: { type: 'string', description: 'Base directory' },
        ignore: { type: 'array', items: { type: 'string' }, description: 'Patterns to ignore' },
        max_depth: { type: 'number', description: 'Max directory depth' }
      },
      required: ['pattern']
    },
    init(root) { repoRoot = root; },
    async execute({ pattern, path: basePath, ignore = ['node_modules', '.git'], max_depth }) {
      const { glob } = await import('glob');
      const cwd = basePath ? resolvePath(basePath) : repoRoot;

      const options = {
        cwd,
        ignore: ignore.map(p => `**/${p}/**`),
        nodir: true,
        dot: false
      };

      if (max_depth) {
        options.maxDepth = max_depth;
      }

      const files = await glob(pattern, options);

      // Get file stats
      const results = await Promise.all(
        files.slice(0, 500).map(async (file) => {
          try {
            const fullPath = path.join(cwd, file);
            const stats = await fs.stat(fullPath);
            return {
              path: file,
              size: stats.size,
              modified: stats.mtime
            };
          } catch {
            return { path: file };
          }
        })
      );

      return {
        pattern,
        base_path: cwd,
        files: results,
        count: results.length,
        truncated: files.length > 500
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // search_replace - Search and replace across multiple files
  // ─────────────────────────────────────────────────────────────────────────
  search_replace: {
    category: 'search',
    description: 'Search and replace text across multiple files.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex)' },
        replacement: { type: 'string', description: 'Replacement text' },
        path: { type: 'string', description: 'Directory to search' },
        file_pattern: { type: 'string', default: '**/*', description: 'Glob pattern for files' },
        dry_run: { type: 'boolean', default: true, description: 'Preview changes without applying' }
      },
      required: ['pattern', 'replacement']
    },
    init(root) { repoRoot = root; },
    async execute({ pattern, replacement, path: searchPath, file_pattern = '**/*', dry_run = true }) {
      const { glob } = await import('glob');
      const cwd = searchPath ? resolvePath(searchPath) : repoRoot;

      const files = await glob(file_pattern, {
        cwd,
        ignore: ['**/node_modules/**', '**/.git/**'],
        nodir: true
      });

      const regex = new RegExp(pattern, 'g');
      const changes = [];

      for (const file of files.slice(0, 100)) {
        const fullPath = path.join(cwd, file);
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const matches = content.match(regex);

          if (matches && matches.length > 0) {
            const newContent = content.replace(regex, replacement);
            changes.push({
              file,
              matches: matches.length,
              preview: matches.slice(0, 3)
            });

            if (!dry_run) {
              await fs.writeFile(fullPath, newContent, 'utf-8');
            }
          }
        } catch {
          // Skip binary files or unreadable files
        }
      }

      return {
        pattern,
        replacement,
        dry_run,
        files_changed: changes.length,
        changes
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // search_symbols - Search for code symbols (functions, classes, etc.)
  // ─────────────────────────────────────────────────────────────────────────
  search_symbols: {
    category: 'search',
    description: 'Search for code symbols like functions, classes, exports.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to search' },
        type: {
          type: 'string',
          enum: ['function', 'class', 'export', 'import', 'const', 'let', 'var', 'any'],
          default: 'any'
        },
        path: { type: 'string', description: 'Directory to search' },
        file_type: { type: 'string', default: 'js', description: 'File type (js, ts, etc.)' }
      },
      required: ['name']
    },
    init(root) { repoRoot = root; },
    async execute({ name, type = 'any', path: searchPath, file_type = 'js' }) {
      const targetPath = searchPath ? resolvePath(searchPath) : repoRoot;

      // Build pattern based on type
      let patterns = [];
      if (type === 'function' || type === 'any') {
        patterns.push(`function\\s+${name}\\s*\\(`);
        patterns.push(`const\\s+${name}\\s*=\\s*(?:async\\s+)?(?:function|\\()`);
        patterns.push(`${name}\\s*:\\s*(?:async\\s+)?function`);
      }
      if (type === 'class' || type === 'any') {
        patterns.push(`class\\s+${name}\\s*[{<]`);
      }
      if (type === 'export' || type === 'any') {
        patterns.push(`export\\s+(?:default\\s+)?(?:function|class|const|let|var)?\\s*${name}`);
      }
      if (type === 'import' || type === 'any') {
        patterns.push(`import\\s+.*${name}.*from`);
      }
      if (type === 'const' || type === 'any') {
        patterns.push(`const\\s+${name}\\s*=`);
      }
      if (type === 'let' || type === 'any') {
        patterns.push(`let\\s+${name}\\s*=`);
      }
      if (type === 'var' || type === 'any') {
        patterns.push(`var\\s+${name}\\s*=`);
      }

      const pattern = patterns.join('|');
      const cmd = `rg -n -t ${file_type} "${pattern}" "${targetPath}" 2>/dev/null || true`;

      try {
        const { stdout } = await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 });
        const lines = stdout.trim().split('\n').filter(Boolean);

        const results = lines.map(line => {
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            return {
              file: match[1].replace(repoRoot + '/', ''),
              line: parseInt(match[2]),
              content: match[3].trim()
            };
          }
          return null;
        }).filter(Boolean);

        return {
          symbol: name,
          type,
          results,
          count: results.length
        };
      } catch (err) {
        return { symbol: name, type, results: [], count: 0, error: err.message };
      }
    }
  }
};
