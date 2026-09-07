// tests/mcp/http-auth.test.js
// 2026-09-03: The HTTP surface — bearer guard, session lifecycle, /health.
// Uses the real Streamable HTTP transport in JSON-response mode via supertest.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, it, expect, afterAll } from '@jest/globals';
import { createMcpHttpApp } from '../../server/mcp/http-app.js';
import { createVectoMcpServer } from '../../server/mcp/create-server.js';
import { makeBearerGuard, constantTimeEqual, parseBearer, assertUsableToken } from '../../server/mcp/auth.js';
import { makeFakeStore } from './fake-store.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
const ACCEPT = 'application/json, text/event-stream';

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '0' } } };

function buildApp() {
  return createMcpHttpApp({
    createServer: () => createVectoMcpServer({ store: makeFakeStore(), baseDir: REPO_ROOT, version: '0.0.0-test', audit: (_n, fn) => fn }),
    token: TOKEN,
    version: '0.0.0-test',
    enableJsonResponse: true,
    log: () => {},
  });
}

describe('auth helpers (pure)', () => {
  it('constantTimeEqual handles length mismatch and non-strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual(undefined, 'abc')).toBe(false);
  });
  it('parseBearer is case-insensitive on the scheme and trims', () => {
    expect(parseBearer('Bearer  xyz ')).toBe('xyz');
    expect(parseBearer('bearer xyz')).toBe('xyz');
    expect(parseBearer('Basic xyz')).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });
  it('refuses to build a guard without a usable token (fail loud at boot)', () => {
    expect(() => assertUsableToken(undefined)).toThrow(/MCP_TOKEN is not set/);
    expect(() => assertUsableToken('short')).toThrow(/too short/);
    expect(() => makeBearerGuard('')).toThrow(/MCP_TOKEN/);
    expect(() => makeBearerGuard(TOKEN)).not.toThrow();
  });
});

describe('MCP HTTP app', () => {
  const app = buildApp();
  afterAll(async () => { await app.locals.closeAllSessions(); });

  it('GET /health is open and secret-free', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'vecto-pilot', transport: 'streamable-http' });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('rejects /mcp without a bearer token, with a wrong one, and with a wrong scheme', async () => {
    const none = await request(app).post('/mcp').set('Accept', ACCEPT).send(INIT);
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toMatch(/Bearer/);
    expect(none.body.error.message).toMatch(/missing bearer token/);
    const wrong = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN.slice(0, -1)}x`).send(INIT);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toMatch(/invalid bearer token/);
    const basic = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Basic ${TOKEN}`).send(INIT);
    expect(basic.status).toBe(401);
    const get = await request(app).get('/mcp');
    expect(get.status).toBe(401);
  });

  it('rejects a non-initialize POST without a session id', async () => {
    const res = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN}`)
      .send({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not an initialize request/);
  });

  it('initializes a session, serves tools/list on it, and tears it down on DELETE', async () => {
    const init = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN}`).send(INIT);
    expect(init.status).toBe(200);
    const sessionId = init.headers['mcp-session-id'];
    expect(typeof sessionId).toBe('string');
    expect(init.body.result.serverInfo.name).toBe('vecto-pilot');
    expect(init.body.result.capabilities.tools).toBeDefined();
    expect(app.locals.mcpSessions.has(sessionId)).toBe(true);

    await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN}`).set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN}`).set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(list.status).toBe(200);
    expect(list.body.result.tools.map(t => t.name)).toContain('boot_context');

    const call = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN}`).set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'app_rules_list', arguments: {} } });
    expect(call.status).toBe(200);
    expect(call.body.result.structuredContent.rows[0].rule_key).toBe('no-fallbacks');

    const unknown = await request(app).post('/mcp').set('Accept', ACCEPT).set('Authorization', `Bearer ${TOKEN}`).set('Mcp-Session-Id', 'nope')
      .send({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });
    expect(unknown.status).toBe(404);

    const del = await request(app).delete('/mcp').set('Authorization', `Bearer ${TOKEN}`).set('Mcp-Session-Id', sessionId);
    expect([200, 204]).toContain(del.status);
    expect(app.locals.mcpSessions.has(sessionId)).toBe(false);
  });
});
