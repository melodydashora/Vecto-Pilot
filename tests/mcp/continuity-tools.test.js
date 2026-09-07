// tests/mcp/continuity-tools.test.js
// 2026-09-03: End-to-end MCP protocol tests for the continuity tools — a real
// MCP Client over InMemoryTransport against createVectoMcpServer with a fake
// store. No database, no HTTP.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVectoMcpServer } from '../../server/mcp/create-server.js';
import { makeFakeStore } from './fake-store.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const noAudit = (_name, fn) => fn;

async function connect({ readOnly = false, store = makeFakeStore() } = {}) {
  const server = createVectoMcpServer({ store, baseDir: REPO_ROOT, version: '0.0.0-test', readOnly, audit: noAudit });
  const client = new Client({ name: 'vecto-test-client', version: '1.2.3' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client, store, close: async () => { await client.close(); await server.close(); } };
}

// SDK 1.30 (verified 2026-09-03): input-validation failures and unknown tools come
// back as isError results ("MCP error -32602: …"), not as rejected promises.
async function expectToolError(client, name, args, re) {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(re);
  return res;
}

const READ_TOOLS = ['boot_context', 'memory_search', 'memory_get', 'todo_list', 'lessons_list', 'definitions_lookup', 'app_rules_list', 'repo_read_file', 'repo_list_dir', 'repo_search', 'repo_git'];
const WRITE_TOOLS = ['memory_add', 'memory_set_status', 'todo_add', 'todo_set_status', 'lesson_add', 'definition_add', 'definition_update'];

describe('MCP continuity tools (read/write)', () => {
  let ctx;
  beforeAll(async () => { ctx = await connect(); });
  afterAll(async () => { await ctx.close(); });

  it('lists every read and write tool with annotations', async () => {
    const { tools } = await ctx.client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    const search = tools.find(t => t.name === 'memory_search');
    expect(search.annotations.readOnlyHint).toBe(true);
    expect(tools.find(t => t.name === 'memory_add').annotations.readOnlyHint).toBe(false);
    expect(search.inputSchema.properties.status.enum).toContain('resolved');
  });

  it('boot_context returns the wake-up pack', async () => {
    const res = await ctx.client.callTool({ name: 'boot_context', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.counts.memory_active).toBe(2);
    expect(res.structuredContent.app_rules[0].rule_key).toBe('no-fallbacks');
    expect(res.structuredContent.definition_terms).toEqual(['agent bridge']);
    expect(JSON.parse(res.content[0].text).todo_open).toHaveLength(1);
  });

  it('memory_search defaults to active and honors query/status/tag', async () => {
    const all = await ctx.client.callTool({ name: 'memory_search', arguments: {} });
    expect(all.structuredContent.rows.map(r => r.id)).toEqual([1, 2]);
    const any = await ctx.client.callTool({ name: 'memory_search', arguments: { status: 'any' } });
    expect(any.structuredContent.rows).toHaveLength(3);
    const byTag = await ctx.client.callTool({ name: 'memory_search', arguments: { tag: 'mcp' } });
    expect(byTag.structuredContent.rows.map(r => r.id)).toEqual([1]);
    const byQuery = await ctx.client.callTool({ name: 'memory_search', arguments: { query: 'child' } });
    expect(byQuery.structuredContent.rows.map(r => r.id)).toEqual([2]);
  });

  it('memory_search rejects an unknown status at the schema boundary', async () => {
    await expectToolError(ctx.client, 'memory_search', { status: 'closed' }, /-32602.*status/i);
  });

  it('memory_get returns the row, parent chain and children', async () => {
    const res = await ctx.client.callTool({ name: 'memory_get', arguments: { id: 2 } });
    expect(res.structuredContent.row.id).toBe(2);
    expect(res.structuredContent.parents.map(p => p.id)).toEqual([1]);
    const root = await ctx.client.callTool({ name: 'memory_get', arguments: { id: 1 } });
    expect(root.structuredContent.children.map(c => c.id)).toEqual([2]);
  });

  it('memory_get on a missing id is a loud tool error, not a silent null', async () => {
    const res = await ctx.client.callTool({ name: 'memory_get', arguments: { id: 999 } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/999 not found/);
  });

  it('memory_add inserts, stamps the client for provenance, and validates parent_id', async () => {
    const res = await ctx.client.callTool({ name: 'memory_add', arguments: {
      session_id: 'mcp-test', category: 'session', title: 'Added via MCP', content: 'because', tags: ['t'], parent_id: 1,
    } });
    expect(res.isError).toBeFalsy();
    const row = res.structuredContent;
    expect(row.id).toBeGreaterThanOrEqual(1000);
    expect(row.metadata.mcp_client).toEqual({ name: 'vecto-test-client', version: '1.2.3' });
    expect(row.source).toBe('mcp');
    const bad = await ctx.client.callTool({ name: 'memory_add', arguments: { session_id: 's', category: 'c', title: 't', content: 'x', parent_id: 4242 } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/parent_id 4242 does not exist/);
  });

  it('memory_add requires title/content (schema)', async () => {
    await expectToolError(ctx.client, 'memory_add', { session_id: 's', category: 'c', content: 'x' }, /-32602.*title/);
  });

  it('memory_set_status accepts the live vocabulary and rejects invented values', async () => {
    const ok = await ctx.client.callTool({ name: 'memory_set_status', arguments: { id: 1, status: 'resolved' } });
    expect(ok.structuredContent.status).toBe('resolved');
    await expectToolError(ctx.client, 'memory_set_status', { id: 1, status: 'deleted' }, /-32602.*status/);
    const missing = await ctx.client.callTool({ name: 'memory_set_status', arguments: { id: 777, status: 'done' } });
    expect(missing.isError).toBe(true);
  });

  it('todo tools mirror the CHECK constraint vocabulary exactly', async () => {
    const open = await ctx.client.callTool({ name: 'todo_list', arguments: {} });
    expect(open.structuredContent.rows.map(t => t.id)).toEqual([10]);
    const done = await ctx.client.callTool({ name: 'todo_list', arguments: { statuses: ['done'] } });
    expect(done.structuredContent.rows.map(t => t.id)).toEqual([11]);
    await expectToolError(ctx.client, 'todo_set_status', { id: 10, status: 'closed' }, /-32602.*"open"\|"in_progress"\|"done"\|"wontfix"/);
    const flipped = await ctx.client.callTool({ name: 'todo_set_status', arguments: { id: 10, status: 'wontfix' } });
    expect(flipped.structuredContent.status).toBe('wontfix');
    const added = await ctx.client.callTool({ name: 'todo_add', arguments: { title: 'New', priority: 2, source_memory_id: 1 } });
    expect(added.structuredContent.status).toBe('open');
    expect(added.structuredContent.priority).toBe(2);
  });

  it('lesson_add and lessons_list round-trip; severity is enum-guarded', async () => {
    const res = await ctx.client.callTool({ name: 'lesson_add', arguments: { lesson: 'L', trigger: 'T', rule: 'R', severity: 'critical' } });
    expect(res.structuredContent.severity).toBe('critical');
    await expectToolError(ctx.client, 'lesson_add', { lesson: 'L', severity: 'urgent' }, /-32602.*severity/);
    const list = await ctx.client.callTool({ name: 'lessons_list', arguments: { severity: 'critical' } });
    expect(list.structuredContent.rows).toHaveLength(1);
  });

  it('definition_add refuses duplicates loudly; definition_update is by id and needs a field', async () => {
    const dup = await ctx.client.callTool({ name: 'definition_add', arguments: { term: 'Agent Bridge', meaning: 'x' } });
    expect(dup.isError).toBe(true);
    expect(dup.content[0].text).toMatch(/already exists as id 30/);
    const ok = await ctx.client.callTool({ name: 'definition_add', arguments: { term: 'MCP server', meaning: 'mcp-server.js' } });
    expect(ok.structuredContent.term).toBe('MCP server');
    const empty = await ctx.client.callTool({ name: 'definition_update', arguments: { id: 30 } });
    expect(empty.isError).toBe(true);
    const upd = await ctx.client.callTool({ name: 'definition_update', arguments: { id: 30, aliases: 'bridge, agent-bridge' } });
    expect(upd.structuredContent.aliases).toBe('bridge, agent-bridge');
    const found = await ctx.client.callTool({ name: 'definitions_lookup', arguments: { query: 'mcp' } });
    expect(found.structuredContent.rows.map(d => d.term)).toEqual(['MCP server']);
  });

  it('app_rules_list is read-only (no write tool exists for it)', async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.some(t => /app_rule/.test(t.name) && !t.annotations.readOnlyHint)).toBe(false);
    const res = await ctx.client.callTool({ name: 'app_rules_list', arguments: {} });
    expect(res.structuredContent.rows[0].provenance).toBe('melody');
  });

  it('exposes the governing documents as resources', async () => {
    const { resources } = await ctx.client.listResources();
    const uris = resources.map(r => r.uri);
    expect(uris).toEqual(expect.arrayContaining(['vecto://doc/CLAUDE.md', 'vecto://doc/AI_PARTNERSHIP_AGREEMENT.md', 'vecto://doc/ARCHITECTURE.md']));
    const doc = await ctx.client.readResource({ uri: 'vecto://doc/CLAUDE.md' });
    expect(doc.contents[0].text).toMatch(/^# CLAUDE\.md/);
  });
});

describe('MCP continuity tools (read-only instance)', () => {
  it('registers no write tools at all when readOnly is set', async () => {
    const ctx = await connect({ readOnly: true });
    try {
      const { tools } = await ctx.client.listTools();
      const names = tools.map(t => t.name);
      for (const w of WRITE_TOOLS) expect(names).not.toContain(w);
      for (const r of READ_TOOLS) expect(names).toContain(r);
      await expectToolError(ctx.client, 'memory_add', { session_id: 's', category: 'c', title: 't', content: 'x' }, /Tool memory_add not found/);
    } finally {
      await ctx.close();
    }
  });
});
