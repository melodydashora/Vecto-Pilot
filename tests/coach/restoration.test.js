import { describe, test, expect, jest, afterEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { coach_memos } from '../../shared/schema.js';
import { buildCoachResponseRequest, callCoachResponses, readCoachResponse } from '../../server/lib/ai/adapters/coach-responses.js';
import { createCoachMemoStore, createCoachMemosRouter, saveMemoWithReceipt } from '../../server/api/rideshare-coach/memos.js';
import { formatCoachSourceContext } from '../../server/lib/ai/coach-source-context.js';
import { getRoleConfig } from '../../server/lib/ai/model-registry.js';

const config = { model: 'gpt-6-astra', reasoningEffort: 'low', maxTokens: 16384, features: ['web_search', 'vision'] };
const history = [{ role: 'user', parts: [{ text: 'Please remember this' }] }];
const originalRole = process.env.AI_COACH_MODEL;
const originalOverride = process.env.AI_COACH_OVERRIDE_MODEL;
afterEach(() => {
  for (const [key, value] of [['AI_COACH_MODEL', originalRole], ['AI_COACH_OVERRIDE_MODEL', originalOverride]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function stream(events, chunkSize = 9) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }));
}
async function collect(response) { const events = []; for await (const event of readCoachResponse(response)) events.push(event); return events; }

describe('Canonical Coach Responses contract', () => {
  test('uses supported low reasoning and search without incompatible sampling parameters', () => {
    const body = buildCoachResponseRequest(config, { system: 'Coach actions', messageHistory: history });
    expect(body).toMatchObject({ model: 'gpt-6-astra', reasoning: { effort: 'low' }, store: false, stream: true, tools: [{ type: 'web_search' }] });
    for (const key of ['temperature', 'top_p', 'top_logprobs']) expect(body).not.toHaveProperty(key);
  });
  test('preserves prior assistant turns, images and PDF/document contents', () => {
    const input = buildCoachResponseRequest(config, { system: 's', messageHistory: [
      { role: 'user', parts: [{ text: 'Earlier image' }, { inline_data: { mime_type: 'image/png', data: 'aW1n' } }] },
      { role: 'model', parts: [{ text: 'Earlier answer' }] },
      { role: 'user', parts: [{ text: 'Read these' }, { filename: 'report.pdf', inline_data: { mime_type: 'application/pdf', data: 'cGRm' } }, { filename: 'note.docx', inline_data: { mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: 'ZG9j' } }] },
    ] }).input;
    expect(input[0].content[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,aW1n' });
    expect(input[1]).toEqual({ role: 'assistant', content: [{ type: 'output_text', text: 'Earlier answer' }] });
    expect(input[2].content[1]).toMatchObject({ type: 'input_file', filename: 'report.pdf', file_data: 'data:application/pdf;base64,cGRm' });
    expect(input[2].content[2].filename).toBe('note.docx');
  });
  test('normalizes chunked UTF-8, completion and source links', async () => {
    const events = await collect(stream([
      { type: 'response.output_text.delta', delta: 'Café 🎙️' },
      { type: 'response.completed', response: { status: 'completed', model: 'gpt-6-astra', output: [{ content: [{ annotations: [{ type: 'url_citation', title: 'Verified source', url: 'https://example.test/info' }] }] }] } },
    ], 1));
    expect(events[0].delta).toBe('Café 🎙️');
    expect(events[1]).toMatchObject({ completed: true, model: 'gpt-6-astra' });
    expect(events[1].delta).toContain('[Verified source](https://example.test/info)');
  });
  test.each(['response.incomplete', 'response.failed', 'error'])('rejects %s after partial text', async type => {
    await expect(collect(stream([{ type: 'response.output_text.delta', delta: '[COACH_MEMO: {}]' }, { type }]))).rejects.toThrow('No requested changes were applied');
  });
  test('requires actual completion and surfaces HTTP failure', async () => {
    await expect(collect(stream([{ type: 'response.output_text.delta', delta: 'Saved!' }]))).rejects.toThrow('before confirmation');
    await expect(collect(new Response('unavailable', { status: 503 }))).rejects.toThrow('HTTP 503');
  });
  test('missing credentials make no provider call; cancellation reaches the request', async () => {
    const fetchImpl = jest.fn(async (_url, init) => { expect(init.signal.aborted).toBe(true); return new Response('', { status: 503 }); });
    await expect(callCoachResponses(config, { system: 's', messageHistory: history }, { apiKey: '', fetchImpl })).rejects.toThrow('not configured');
    expect(fetchImpl).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await callCoachResponses(config, { system: 's', messageHistory: history, signal: controller.signal }, { apiKey: 'synthetic', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test('role is pinned to Astra in the registry; env cannot change it (2026-09-15 pin policy)', () => {
    process.env.AI_COACH_MODEL = 'gemini-synthetic'; process.env.AI_COACH_OVERRIDE_MODEL = 'gemini-synthetic';
    expect(getRoleConfig('AI_COACH')).toMatchObject({ model: 'gpt-6-astra', reasoningEffort: 'low', provider: 'openai' });
  });
});

describe('Durable memo receipts and ownership', () => {
  const rows = [{ id: 'memo-a', triggering_user_id: 'alice', type: 'bug', title: 'A', detail: 'Private A' }, { id: 'memo-b', triggering_user_id: 'bob', type: 'feature_request', title: 'B', detail: 'Private B' }];
  function app(user, store) {
    const server = express();
    server.use((req, _res, next) => { if (user) req.auth = { userId: user }; next(); });
    server.use('/memos', createCoachMemosRouter(store));
    return server;
  }
  test('actual store always compiles an ownership predicate and route ignores spoofed userId', async () => {
    let query;
    const db = { select: () => ({ from: () => ({ where: expression => {
      query = new PgDialect().sqlToQuery(expression);
      return { orderBy: () => ({ limit: async limit => rows.filter(row => row.triggering_user_id === query.params[0]).slice(0, limit) }) };
    } }) }) };
    const store = createCoachMemoStore(db, coach_memos);
    const response = await request(app('alice', store)).get('/memos?userId=bob&limit=9999');
    expect(response.status).toBe(200);
    expect(query.sql).toContain('triggering_user_id');
    expect(query.params).toEqual(['alice']);
    expect(response.body.memos.map(row => row.id)).toEqual(['memo-a']);
    expect((await request(app('bob', store)).get('/memos')).body.memos.map(row => row.id)).toEqual(['memo-b']);
  });
  test('unauthenticated and failed reads are distinct from a successful empty list', async () => {
    const store = { list: jest.fn(async () => []) };
    expect((await request(app(null, store)).get('/memos')).status).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
    expect((await request(app('alice', store)).get('/memos')).body).toEqual({ ok: true, memos: [] });
    store.list.mockRejectedValueOnce(new Error('database offline'));
    expect((await request(app('alice', store)).get('/memos')).status).toBe(500);
  });
  test('receipt appears only after durable write with authenticated provenance', async () => {
    const save = jest.fn(async data => ({ ...data, id: 'saved-id', created_at: '2026-09-10T12:00:00Z' }));
    const receipt = await saveMemoWithReceipt(save, { type: 'bug', title: 'Issue', detail: 'Detail', triggering_user_id: 'bob' }, { userId: 'alice', snapshotId: 'snapshot-a', conversationId: 'conversation-a' });
    expect(save.mock.calls[0][0]).toMatchObject({ triggering_user_id: 'alice', triggering_snapshot_id: 'snapshot-a', triggering_conversation_id: 'conversation-a' });
    expect(receipt).toEqual({ id: 'saved-id', type: 'bug', title: 'Issue', created_at: '2026-09-10T12:00:00Z' });
  });
  test('failed/null writes and unauthenticated requests produce no success receipt', async () => {
    await expect(saveMemoWithReceipt(async () => null, {}, { userId: 'alice' })).rejects.toThrow('a saved record');
    await expect(saveMemoWithReceipt(async () => { throw new Error('database offline'); }, {}, { userId: 'alice' })).rejects.toThrow('database offline');
    const save = jest.fn();
    await expect(saveMemoWithReceipt(save, {}, {})).rejects.toThrow('Authenticated');
    expect(save).not.toHaveBeenCalled();
  });
});

test('Coach receives the full saved snapshot and Briefing including pending/error evidence', () => {
  const snapshot = { snapshot_id: 's1', created_at: '2026-09-10', location: { lat: 1, lng: 2 }, extra_context: 'preserved' };
  const row = { snapshot_id: 's1', status: 'pending', generated_at: null, events: { _generationFailed: true, error: 'timeout' }, school_closures: { districts: [{ name: 'Full school detail' }] }, future_section: { retained: true } };
  const prompt = formatCoachSourceContext(snapshot, { source_record: row, events: [] });
  expect(prompt).toContain('Full school detail');
  expect(prompt).toContain('future_section');
  expect(prompt).toContain('extra_context');
  expect(prompt).toContain('"_generationFailed": true');
  expect(prompt).toContain('never as clear conditions or a fresh complete briefing');
  expect(formatCoachSourceContext(snapshot, { status: 'error', source_state: 'read_failed' })).toContain('read_failed');
});
