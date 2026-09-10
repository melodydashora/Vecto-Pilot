// server/mcp/repo-tools.js
// Read-only repository tools for the standalone MCP server.
//
// 2026-09-03: Created with the MCP server. Deliberately NOT the agent server's
// shell/fs-write/sql surface — those stay on agent-server.js (43717) behind
// its own token and the gateway bridge. This module only reads: file, dir,
// grep, and three fixed-argument git subcommands. Path resolution mirrors the
// resolveSafe() pattern in agent-server.js / server/lib/ability-routes.js, and
// adds a deny list + `git check-ignore` so secrets and build artifacts are
// never readable through MCP even with a valid token.

import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { toolResult } from './continuity-tools.js';

const execFileAsync = promisify(execFile);

export const MAX_READ_BYTES = 512 * 1024;      // 512 KB per read (tool results go into a context window)
export const MAX_SEARCH_RESULTS = 200;
const EXEC_TIMEOUT_MS = 20_000;
const EXEC_MAX_BUFFER = 8 * 1024 * 1024;

// Directories that are never listed, read, or searched.
export const DENIED_DIRS = ['node_modules', '.git', '.cache', '.local', '.worktrees', 'logs', 'data', 'dist', 'coverage', '.npm'];
// File name patterns that are never read (secrets), regardless of gitignore.
const DENIED_FILE_PATTERNS = [
  /(^|\/)\.env(\.|$)/,                 // .env, .env.local, .env.production … (but NOT .env.local.example? — it matches; handled below)
  /\.(pem|key|p12|pfx|crt|jks)$/i,
  /(^|\/)\.replit-assistant-override\.json$/,
];
const ALLOWED_EXAMPLE_ENV = /(^|\/)\.env(\.[a-z]+)?\.example$/;

/** Resolve a repo-relative path inside baseDir; throws on traversal. */
export function resolveInRepo(baseDir, p) {
  const base = path.resolve(baseDir);
  const abs = path.resolve(base, p || '.');
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    const err = new Error(`path-outside-repo: ${p}`);
    err.code = 'PATH_OUTSIDE_BASE';
    throw err;
  }
  return { abs, rel: path.relative(base, abs).split(path.sep).join('/') };
}

/** Deny-list check on a repo-relative POSIX path. Throws with a reason. */
export function assertAllowedPath(rel) {
  const segments = rel.split('/').filter(Boolean);
  const denied = segments.find(s => DENIED_DIRS.includes(s));
  if (denied) {
    const err = new Error(`path-denied: '${denied}' is not readable through MCP (${rel})`);
    err.code = 'PATH_DENIED';
    throw err;
  }
  if (!ALLOWED_EXAMPLE_ENV.test(rel) && DENIED_FILE_PATTERNS.some(re => re.test(rel))) {
    const err = new Error(`path-denied: secrets-shaped file is not readable through MCP (${rel})`);
    err.code = 'PATH_DENIED';
    throw err;
  }
}

async function isGitIgnored(baseDir, rel) {
  if (!rel || rel === '.') return false;
  try {
    await execFileAsync('git', ['-C', baseDir, 'check-ignore', '-q', '--', rel], { timeout: 5000 });
    return true;               // exit 0 → ignored
  } catch (err) {
    if (typeof err.code === 'number' && err.code === 1) return false;   // exit 1 → not ignored
    return false;              // git unavailable / not a repo → do not block on it
  }
}

/**
 * 2026-09-10 (security finding [6], verified): read_file consulted the deny list + gitignore,
 * but search results and directory listings did not, so grep could return lines from .env /
 * key files and list_dir could name them. One batched `git check-ignore --stdin` per call.
 */
async function gitIgnoredSet(baseDir, rels) {
  const list = rels.filter(r => r && r !== '.');
  if (!list.length) return new Set();
  return new Promise((resolve) => {
    const child = execFile('git', ['-C', baseDir, 'check-ignore', '--stdin'], { timeout: 5000, maxBuffer: EXEC_MAX_BUFFER }, (err, stdout) => {
      // exit 0 → some ignored (listed on stdout); exit 1 → none; anything else → don't block on git
      if (err && !(typeof err.code === 'number' && (err.code === 0 || err.code === 1))) return resolve(new Set());
      resolve(new Set(String(stdout || '').split('\n').filter(Boolean)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(list.join('\n') + '\n');
  });
}

function isDeniedRel(rel) {
  try { assertAllowedPath(rel); return false; } catch { return true; }
}

async function guardedPath(baseDir, p) {
  const { abs, rel } = resolveInRepo(baseDir, p);
  assertAllowedPath(rel);
  if (await isGitIgnored(baseDir, rel)) {
    const err = new Error(`path-denied: '${rel}' is gitignored and not readable through MCP`);
    err.code = 'PATH_DENIED';
    throw err;
  }
  return { abs, rel };
}

const GIT_SUBCOMMANDS = {
  status: () => ['status', '--short', '--branch'],
  log: ({ count }) => ['log', `--max-count=${count}`, '--date=short', '--format=%h %ad %an%d %s'],
  diff_stat: () => ['diff', '--stat'],
};

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ baseDir: string, audit?: (name: string, fn: Function) => Function }} options
 */
export function registerRepoTools(server, { baseDir, audit = (_n, fn) => fn }) {
  if (!baseDir) throw new Error('registerRepoTools: baseDir is required');
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('repo_read_file', {
    title: 'Read a repository file',
    description: `Read a UTF-8 text file by repo-relative path (max ${MAX_READ_BYTES} bytes; use offset/limit lines for big files). Secrets (.env*, keys), gitignored files, and ${DENIED_DIRS.join(', ')} are refused.`,
    inputSchema: {
      path: z.string().min(1).max(1000),
      offset: z.number().int().min(1).optional().describe('1-based first line to return'),
      limit: z.number().int().min(1).max(5000).optional().describe('Number of lines to return'),
    },
    annotations: ro,
  }, audit('repo_read_file', async ({ path: p, offset, limit }) => {
    const { abs, rel } = await guardedPath(baseDir, p);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error(`not-a-file: ${rel}`);
    if (stat.size > MAX_READ_BYTES && !(offset || limit)) {
      throw new Error(`file-too-large: ${rel} is ${stat.size} bytes (max ${MAX_READ_BYTES}); pass offset/limit to read a slice`);
    }
    const text = await fs.readFile(abs, 'utf8');
    const lines = text.split('\n');
    const start = Math.max((offset || 1) - 1, 0);
    const end = limit ? Math.min(start + limit, lines.length) : lines.length;
    const slice = lines.slice(start, end).join('\n');
    if (Buffer.byteLength(slice, 'utf8') > MAX_READ_BYTES) {
      throw new Error(`slice-too-large: requested slice of ${rel} exceeds ${MAX_READ_BYTES} bytes; narrow limit`);
    }
    return {
      content: [{ type: 'text', text: slice }],
      structuredContent: { path: rel, size: stat.size, total_lines: lines.length, from_line: start + 1, to_line: end, modified: stat.mtime.toISOString() },
    };
  }));

  server.registerTool('repo_list_dir', {
    title: 'List a repository directory',
    description: 'List entries (name, type, size) of a repo-relative directory. Denied directories are omitted from listings.',
    inputSchema: { path: z.string().max(1000).optional().describe("Default '.'") },
    annotations: ro,
  }, audit('repo_list_dir', async ({ path: p }) => {
    const { abs, rel } = await guardedPath(baseDir, p || '.');
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const rows = [];
    const candidateRels = entries.filter(e => !DENIED_DIRS.includes(e.name)).map(e => (rel ? `${rel}/${e.name}` : e.name));
    const ignored = await gitIgnoredSet(baseDir, candidateRels);
    for (const e of entries) {
      if (DENIED_DIRS.includes(e.name)) continue;
      const entryRel = rel ? `${rel}/${e.name}` : e.name;
      if (isDeniedRel(entryRel) || ignored.has(entryRel)) continue;   // secrets-shaped or gitignored: not listed
      let size = null;
      if (e.isFile()) {
        try { size = (await fs.stat(path.join(abs, e.name))).size; } catch { size = null; }
      }
      rows.push({ name: e.name, type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other', size });
    }
    rows.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    return toolResult({ path: rel || '.', entries: rows });
  }));

  server.registerTool('repo_search', {
    title: 'Search repository text (grep)',
    description: `Recursive, case-insensitive fixed-args grep (-rnI) under a repo-relative path, excluding ${DENIED_DIRS.join(', ')}. Returns file:line:text rows (max ${MAX_SEARCH_RESULTS}). A grep proves a string exists — read the file before concluding what the code does.`,
    inputSchema: {
      pattern: z.string().min(1).max(300).describe('Extended regex (grep -E)'),
      path: z.string().max(1000).optional().describe("Default '.'"),
      glob: z.string().max(100).optional().describe("--include glob, e.g. '*.js'"),
      max_results: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional().describe(`Default ${MAX_SEARCH_RESULTS}`),
    },
    annotations: ro,
  }, audit('repo_search', async ({ pattern, path: p, glob, max_results }) => {
    const { abs, rel } = await guardedPath(baseDir, p || '.');
    const max = max_results || MAX_SEARCH_RESULTS;
    const args = ['-rnIE', '--color=never', ...DENIED_DIRS.map(d => `--exclude-dir=${d}`), '--exclude=package-lock.json'];
    if (glob) args.push(`--include=${glob}`);
    args.push('-e', pattern, '--', abs);
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('grep', args, { cwd: baseDir, timeout: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER }));
    } catch (err) {
      if (typeof err.code === 'number' && err.code === 1) stdout = '';   // no matches
      else throw new Error(`grep failed: ${err.stderr || err.message}`);
    }
    const base = path.resolve(baseDir);
    const parsed = stdout.split('\n').filter(Boolean).map(line => {
      const m = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!m) return { file: path.relative(base, line).split(path.sep).join('/'), line: null, text: '' };
      return { file: path.relative(base, m[1]).split(path.sep).join('/'), line: Number(m[2]), text: m[3].slice(0, 400) };
    });
    // Apply the read-side policy to every hit BEFORE counting/truncating, so a deny-listed or
    // gitignored file contributes neither content nor a tell-tale count.
    const files = [...new Set(parsed.map(r => r.file))];
    const ignored = await gitIgnoredSet(baseDir, files);
    const allowed = new Set(files.filter(f => !isDeniedRel(f) && !ignored.has(f)));
    const all = parsed.filter(r => allowed.has(r.file));
    const rows = all.slice(0, max);
    return toolResult({ pattern, path: rel || '.', total_matches: all.length, truncated: all.length > max, rows });
  }));

  server.registerTool('repo_git', {
    title: 'Read-only git query',
    description: 'Fixed-argument git: status (short + branch), log (newest N), diff_stat (working tree vs HEAD). No mutation is possible through this tool.',
    inputSchema: {
      subcommand: z.enum(Object.keys(GIT_SUBCOMMANDS)),
      count: z.number().int().min(1).max(200).optional().describe('log only; default 20'),
    },
    annotations: ro,
  }, audit('repo_git', async ({ subcommand, count }) => {
    const args = ['-C', baseDir, ...GIT_SUBCOMMANDS[subcommand]({ count: count || 20 })];
    const { stdout } = await execFileAsync('git', args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER });
    return { content: [{ type: 'text', text: stdout || '(empty)' }], structuredContent: { subcommand, output: stdout } };
  }));
}
