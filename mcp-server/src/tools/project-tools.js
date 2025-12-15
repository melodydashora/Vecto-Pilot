/**
 * Project Intelligence Tools (5 tools)
 *
 * get_repo_info, code_map, dependency_graph, todo_list, project_stats
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
let repoRoot = process.cwd();

export const projectTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // get_guidelines - Get project guidelines and warnings for safe operation
  // ─────────────────────────────────────────────────────────────────────────
  get_guidelines: {
    category: 'project',
    description: 'IMPORTANT: Call this first! Get project guidelines, warnings, and critical rules before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['all', 'critical_rules', 'common_pitfalls', 'safe_workflow', 'warnings'],
          default: 'all'
        }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ section = 'all' }) {
      const guidelines = {
        warning: "⚠️ THIS CODEBASE CAN BREAK EASILY - Use tools to understand before making changes!",

        critical_rules: {
          model_parameters: {
            "GPT-5.2": "Use { reasoning_effort: 'medium', max_completion_tokens: 32000 } - NOT nested format",
            "Gemini": "Use { generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } }",
            warning: "Wrong parameters cause 400 errors and break the AI pipeline"
          },
          location_data: {
            rule: "GPS-first - never use IP fallback or default locations",
            coordinates: "ONLY from Google APIs - AI models hallucinate coordinates",
            warning: "Bad coordinates break map markers and venue recommendations"
          },
          database: {
            rule: "All data must link to snapshot_id",
            sorting: "Always use created_at DESC (newest first)"
          }
        },

        safe_workflow: {
          step1: "read_file → Read the file you want to change",
          step2: "grep_search → Find all usages of functions you'll modify",
          step3: "search_symbols → Find where things are defined",
          step4: "ai_analyze → Check for potential issues",
          step5: "Make small, focused changes",
          step6: "run_command('npm run typecheck') → Validate changes"
        },

        common_pitfalls: [
          "Breaking API contracts - check all callers before changing signatures",
          "Duplicate code - search for existing implementations first",
          "Wrong model parameters - check /docs/architecture/ai-pipeline.md",
          "Missing error handling - use ai_analyze to check",
          "Trusting AI coordinates - always use Google Geocoding"
        ],

        key_files_to_read: [
          "/CLAUDE.md - Project overview and rules",
          "/ARCHITECTURE.md - System architecture",
          "/LESSONS_LEARNED.md - Past mistakes to avoid",
          "/docs/architecture/ai-pipeline.md - AI model configuration",
          "/docs/architecture/database-schema.md - Database tables"
        ],

        remember: [
          "Understand first, change second - USE THE TOOLS",
          "Small changes - incremental, not big rewrites",
          "Test always - run npm run typecheck",
          "Ask when unsure - better to ask than break",
          "Respect existing patterns - they exist for good reasons"
        ]
      };

      if (section === 'all') {
        return guidelines;
      }

      return { [section]: guidelines[section] || "Section not found" };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // get_repo_info - Get comprehensive project overview
  // ─────────────────────────────────────────────────────────────────────────
  get_repo_info: {
    category: 'project',
    description: 'Get comprehensive project/repository overview.',
    inputSchema: {
      type: 'object',
      properties: {
        include_git: { type: 'boolean', default: true },
        include_package: { type: 'boolean', default: true },
        include_structure: { type: 'boolean', default: true }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ include_git = true, include_package = true, include_structure = true }) {
      const info = {
        root: repoRoot,
        name: path.basename(repoRoot)
      };

      // Git info
      if (include_git) {
        try {
          const [branch, status, remote, lastCommit] = await Promise.all([
            execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot }).then(r => r.stdout.trim()).catch(() => null),
            execAsync('git status --porcelain', { cwd: repoRoot }).then(r => r.stdout.trim()).catch(() => null),
            execAsync('git remote get-url origin', { cwd: repoRoot }).then(r => r.stdout.trim()).catch(() => null),
            execAsync('git log -1 --format="%h %s"', { cwd: repoRoot }).then(r => r.stdout.trim()).catch(() => null)
          ]);

          info.git = {
            branch,
            remote,
            last_commit: lastCommit,
            has_changes: status ? status.split('\n').length : 0,
            is_git_repo: true
          };
        } catch {
          info.git = { is_git_repo: false };
        }
      }

      // Package.json info
      if (include_package) {
        try {
          const pkgPath = path.join(repoRoot, 'package.json');
          const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
          info.package = {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            main: pkg.main,
            type: pkg.type,
            scripts: Object.keys(pkg.scripts || {}),
            dependencies: Object.keys(pkg.dependencies || {}).length,
            devDependencies: Object.keys(pkg.devDependencies || {}).length
          };
        } catch {
          info.package = null;
        }
      }

      // Project structure
      if (include_structure) {
        const structure = [];
        const topLevel = await fs.readdir(repoRoot, { withFileTypes: true });

        for (const entry of topLevel) {
          if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
          if (entry.name === 'node_modules') continue;

          const item = { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' };

          if (entry.isDirectory()) {
            try {
              const subEntries = await fs.readdir(path.join(repoRoot, entry.name));
              item.files = subEntries.filter(f => !f.startsWith('.')).length;
            } catch {
              item.files = 0;
            }
          }

          structure.push(item);
        }

        info.structure = structure;
      }

      // Check for common files
      const commonFiles = ['README.md', 'CLAUDE.md', 'ARCHITECTURE.md', '.env', 'tsconfig.json', 'vite.config.ts'];
      const existingFiles = [];
      for (const file of commonFiles) {
        try {
          await fs.access(path.join(repoRoot, file));
          existingFiles.push(file);
        } catch {}
      }
      info.key_files = existingFiles;

      return info;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // code_map - Generate a map of code structure
  // ─────────────────────────────────────────────────────────────────────────
  code_map: {
    category: 'project',
    description: 'Generate a map of code structure (functions, classes, exports).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to analyze' },
        file_types: { type: 'array', items: { type: 'string' }, default: ['js', 'ts', 'jsx', 'tsx'] },
        max_depth: { type: 'number', default: 3 }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ path: targetPath, file_types = ['js', 'ts', 'jsx', 'tsx'], max_depth = 3 }) {
      const dir = targetPath ? path.join(repoRoot, targetPath) : repoRoot;
      const { glob } = await import('glob');

      const patterns = file_types.map(t => `**/*.${t}`);
      const files = await glob(patterns, {
        cwd: dir,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        maxDepth: max_depth
      });

      const codeMap = [];

      for (const file of files.slice(0, 50)) {
        const fullPath = path.join(dir, file);
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const symbols = {
            file,
            exports: [],
            functions: [],
            classes: [],
            imports: []
          };

          // Find exports
          const exportMatches = content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)?\s*(\w+)/g);
          for (const match of exportMatches) {
            if (match[1]) symbols.exports.push(match[1]);
          }

          // Find functions
          const funcMatches = content.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g);
          for (const match of funcMatches) {
            symbols.functions.push(match[1]);
          }

          // Find classes
          const classMatches = content.matchAll(/class\s+(\w+)/g);
          for (const match of classMatches) {
            symbols.classes.push(match[1]);
          }

          // Find imports
          const importMatches = content.matchAll(/import\s+.*from\s+['"]([^'"]+)['"]/g);
          for (const match of importMatches) {
            symbols.imports.push(match[1]);
          }

          if (symbols.exports.length || symbols.functions.length || symbols.classes.length) {
            codeMap.push(symbols);
          }
        } catch {}
      }

      return {
        root: dir,
        files_analyzed: files.length,
        code_map: codeMap
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // dependency_graph - Analyze project dependencies
  // ─────────────────────────────────────────────────────────────────────────
  dependency_graph: {
    category: 'project',
    description: 'Analyze project dependencies and their relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        include_dev: { type: 'boolean', default: false },
        check_updates: { type: 'boolean', default: false }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ include_dev = false, check_updates = false }) {
      const pkgPath = path.join(repoRoot, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

      const graph = {
        name: pkg.name,
        version: pkg.version,
        dependencies: [],
        devDependencies: []
      };

      // Parse dependencies
      for (const [name, version] of Object.entries(pkg.dependencies || {})) {
        graph.dependencies.push({ name, version });
      }

      if (include_dev) {
        for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
          graph.devDependencies.push({ name, version });
        }
      }

      // Check for outdated packages
      if (check_updates) {
        try {
          const { stdout } = await execAsync('npm outdated --json', { cwd: repoRoot });
          const outdated = JSON.parse(stdout || '{}');
          graph.outdated = Object.entries(outdated).map(([name, info]) => ({
            name,
            current: info.current,
            wanted: info.wanted,
            latest: info.latest
          }));
        } catch (err) {
          // npm outdated exits with code 1 if there are outdated packages
          try {
            const outdated = JSON.parse(err.stdout || '{}');
            graph.outdated = Object.entries(outdated).map(([name, info]) => ({
              name,
              current: info.current,
              wanted: info.wanted,
              latest: info.latest
            }));
          } catch {
            graph.outdated = [];
          }
        }
      }

      return graph;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // todo_list - Find TODOs, FIXMEs, and other markers in code
  // ─────────────────────────────────────────────────────────────────────────
  todo_list: {
    category: 'project',
    description: 'Find TODO, FIXME, HACK, and other code markers.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search' },
        markers: {
          type: 'array',
          items: { type: 'string' },
          default: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG']
        },
        file_types: { type: 'array', items: { type: 'string' } }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ path: searchPath, markers = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'], file_types }) {
      const dir = searchPath ? path.join(repoRoot, searchPath) : repoRoot;
      const pattern = markers.join('|');

      let cmd = `rg -n "(${pattern})[:)]?" "${dir}" --glob "!node_modules" --glob "!.git"`;
      if (file_types && file_types.length > 0) {
        cmd += file_types.map(t => ` -t ${t}`).join('');
      }

      try {
        const { stdout } = await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 });
        const lines = stdout.trim().split('\n').filter(Boolean);

        const todos = lines.map(line => {
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (match) {
            const content = match[3].trim();
            const markerMatch = content.match(new RegExp(`(${pattern})[:)]?\\s*(.*)`, 'i'));
            return {
              file: match[1].replace(repoRoot + '/', ''),
              line: parseInt(match[2]),
              marker: markerMatch ? markerMatch[1].toUpperCase() : 'TODO',
              text: markerMatch ? markerMatch[2].trim() : content
            };
          }
          return null;
        }).filter(Boolean);

        // Group by marker
        const byMarker = {};
        for (const todo of todos) {
          byMarker[todo.marker] = byMarker[todo.marker] || [];
          byMarker[todo.marker].push(todo);
        }

        return {
          total: todos.length,
          by_marker: byMarker,
          items: todos.slice(0, 100)
        };
      } catch (err) {
        if (err.code === 1) {
          return { total: 0, by_marker: {}, items: [] };
        }
        throw err;
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // project_stats - Get project statistics
  // ─────────────────────────────────────────────────────────────────────────
  project_stats: {
    category: 'project',
    description: 'Get detailed project statistics (lines of code, file counts, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        include_git_stats: { type: 'boolean', default: true }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ path: targetPath, include_git_stats = true }) {
      const dir = targetPath ? path.join(repoRoot, targetPath) : repoRoot;
      const stats = {
        directory: dir,
        file_counts: {},
        total_files: 0,
        lines_of_code: {}
      };

      // Count files by extension
      try {
        const { stdout } = await execAsync(
          `find "${dir}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -20`,
          { cwd: dir }
        );
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const match = line.trim().match(/(\d+)\s+(.+)/);
          if (match) {
            stats.file_counts[match[2]] = parseInt(match[1]);
            stats.total_files += parseInt(match[1]);
          }
        }
      } catch {}

      // Lines of code (using wc or cloc if available)
      try {
        const { stdout } = await execAsync(
          `find "${dir}" -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" | grep -v node_modules | xargs wc -l 2>/dev/null | tail -1`,
          { cwd: dir }
        );
        const match = stdout.trim().match(/(\d+)/);
        if (match) {
          stats.lines_of_code.javascript_typescript = parseInt(match[1]);
        }
      } catch {}

      // Git stats
      if (include_git_stats) {
        try {
          const [commits, contributors] = await Promise.all([
            execAsync('git rev-list --count HEAD', { cwd: dir }).then(r => parseInt(r.stdout.trim())).catch(() => 0),
            execAsync('git shortlog -sn --no-merges | wc -l', { cwd: dir }).then(r => parseInt(r.stdout.trim())).catch(() => 0)
          ]);
          stats.git = { total_commits: commits, contributors };
        } catch {
          stats.git = null;
        }
      }

      // Disk usage
      try {
        const { stdout } = await execAsync(`du -sh "${dir}" --exclude=node_modules --exclude=.git`);
        stats.disk_usage = stdout.trim().split('\t')[0];
      } catch {}

      return stats;
    }
  }
};
