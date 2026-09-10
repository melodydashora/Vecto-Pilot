// tests/mcp/repo-tools.test.js
// 2026-09-03: Read-only repo tools — path guard, deny list, grep, git.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVectoMcpServer } from '../../server/mcp/create-server.js';
import { resolveInRepo, assertAllowedPath, DENIED_DIRS } from '../../server/mcp/repo-tools.js';
import { makeFakeStore } from './fake-store.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('repo path guards (pure)', () => {
  it('resolves inside the repo and rejects traversal', () => {
    expect(resolveInRepo(REPO_ROOT, 'package.json').rel).toBe('package.json');
    expect(resolveInRepo(REPO_ROOT, '.').rel).toBe('');
    expect(() => resolveInRepo(REPO_ROOT, '../../etc/passwd')).toThrow(/path-outside-repo/);
    expect(() => resolveInRepo(REPO_ROOT, '/etc/passwd')).toThrow(/path-outside-repo/);
  });

  it('denies secret-shaped files and denied directories, allows the env example', () => {
    expect(() => assertAllowedPath('.env')).toThrow(/secrets-shaped/);
    expect(() => assertAllowedPath('.env.local')).toThrow(/secrets-shaped/);
    expect(() => assertAllowedPath('server/.env.production')).toThrow(/secrets-shaped/);
    expect(() => assertAllowedPath('certs/server.pem')).toThrow(/secrets-shaped/);
    expect(() => assertAllowedPath('.replit-assistant-override.json')).toThrow(/secrets-shaped/);
    for (const d of DENIED_DIRS) expect(() => assertAllowedPath(`${d}/x.js`)).toThrow(new RegExp(`'${d.replace('.', '\\.')}' is not readable`));
    expect(() => assertAllowedPath('client/dist/index.html')).toThrow(/'dist'/);
    expect(() => assertAllowedPath('.env.local.example')).not.toThrow();
    expect(() => assertAllowedPath('server/mcp/auth.js')).not.toThrow();
  });
});

describe('repo tools over MCP', () => {
  let client; let server;
  beforeAll(async () => {
    server = createVectoMcpServer({ store: makeFakeStore(), baseDir: REPO_ROOT, version: '0.0.0-test', audit: (_n, fn) => fn });
    client = new Client({ name: 'repo-test', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
  });
  afterAll(async () => { await client.close(); await server.close(); });

  it('reads a tracked file with line slicing metadata', async () => {
    const res = await client.callTool({ name: 'repo_read_file', arguments: { path: 'package.json' } });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/"name": "vecto-pilot"/);
    expect(res.structuredContent.path).toBe('package.json');
    expect(res.structuredContent.total_lines).toBeGreaterThan(10);
    const slice = await client.callTool({ name: 'repo_read_file', arguments: { path: 'package.json', offset: 2, limit: 1 } });
    expect(slice.structuredContent.from_line).toBe(2);
    expect(slice.structuredContent.to_line).toBe(2);
    expect(slice.content[0].text.split('\n')).toHaveLength(1);
  });

  it('refuses traversal, secrets, gitignored and denied-dir paths as loud tool errors', async () => {
    for (const p of ['../../etc/passwd', '.env.local', 'node_modules/express/package.json', '.git/config', 'logs/x.log']) {
      const res = await client.callTool({ name: 'repo_read_file', arguments: { path: p } });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/path-outside-repo|path-denied/);
    }
  });

  it('lists a directory without denied entries', async () => {
    const res = await client.callTool({ name: 'repo_list_dir', arguments: {} });
    const names = res.structuredContent.entries.map(e => e.name);
    expect(names).toContain('package.json');
    expect(names).toContain('server');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
  });

  it('never lists or returns hits from secrets-shaped or gitignored files (2026-09-10, security finding [6])', async () => {
    // .env / .env.local exist in the workspace (gitignored, secrets-shaped); .env.local.example is tracked.
    const listing = await client.callTool({ name: 'repo_list_dir', arguments: {} });
    const names = listing.structuredContent.entries.map(e => e.name);
    expect(names).not.toContain('.env');
    expect(names).not.toContain('.env.local');
    expect(names).toContain('.env.local.example');

    // DATABASE_URL appears in the real env files AND in the tracked example; only the example may surface.
    const res = await client.callTool({ name: 'repo_search', arguments: { pattern: '^DATABASE_URL=', path: '.' } });
    expect(res.isError).toBeFalsy();
    const files = res.structuredContent.rows.map(r => r.file);
    expect(files.some(f => f === '.env' || f === '.env.local')).toBe(false);
    expect(res.structuredContent.total_matches).toBe(res.structuredContent.rows.length);
    // every surviving env-shaped hit must be a tracked *.example placeholder, never a real env file
    for (const f of files) expect(!/(^|\/)\.env(\.|$)/.test(f) || /\.example$/.test(f)).toBe(true);
  });

  it('greps with fixed args and returns file:line rows', async () => {
    const res = await client.callTool({ name: 'repo_search', arguments: { pattern: 'export function createVectoMcpServer', path: 'server/mcp', glob: '*.js' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.rows.some(r => r.file === 'server/mcp/create-server.js' && r.line > 0)).toBe(true);
    const none = await client.callTool({ name: 'repo_search', arguments: { pattern: 'zzz-no-such-token-zzz', path: 'server/mcp' } });
    expect(none.structuredContent.total_matches).toBe(0);
    // a pattern that looks like an option must not be interpreted as one
    const dashy = await client.callTool({ name: 'repo_search', arguments: { pattern: '--version', path: 'server/mcp' } });
    expect(dashy.isError).toBeFalsy();
  });

  it('repo_git runs only the fixed subcommands', async () => {
    const status = await client.callTool({ name: 'repo_git', arguments: { subcommand: 'status' } });
    expect(status.isError).toBeFalsy();
    expect(status.structuredContent.output).toMatch(/^## /);
    const log = await client.callTool({ name: 'repo_git', arguments: { subcommand: 'log', count: 2 } });
    expect(log.structuredContent.output.trim().split('\n')).toHaveLength(2);
    // SDK 1.30: schema rejections are isError results, not rejected promises.
    const push = await client.callTool({ name: 'repo_git', arguments: { subcommand: 'push' } });
    expect(push.isError).toBe(true);
    expect(push.content[0].text).toMatch(/-32602.*subcommand/);
  });
});
