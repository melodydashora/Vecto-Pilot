const { TextEncoder, Response, ReadableStream, console, AbortSignal } = globalThis;
// tests/coach/chat-completion.test.js
// 2026-09-11: desktop-coach-acceptance "Server behavior" — the REAL /api/chat router with
// real action parsing, validation, saveMemoWithReceipt and completion assembly. Mocked:
// auth, DAL, DB, model transport (readCoachResponse is real over a synthetic Responses
// stream), project context, and the secondary docs/coach-inbox.md filesystem append.
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const USER = '11111111-1111-4111-8111-111111111111';
const appendFile = jest.fn(async () => {});
const readFile = jest.fn(async () => 'STALE_DOCUMENT_MUST_NOT_ENTER_COACH');
const offerWrite = jest.fn(async () => ({ id: 'should-not-write' }));
const calls = { memo: [], note: [], history: [], tips: [] };
let memoBehavior = 'ok';        // ok | throw | null
let providerEvents = [];
let currentContext = null;
let snapshotHistory = [];
let providerHook = null;
let noteHook = null;
let activeResponse;
const providerPrompts = [];
const settingsWrites = [];
let settingsFailure = null;
let coachSnapshot = null;
let coachSnapshotError = null;
let ownedSource = null;
const coachSnapshotReads = [];
const contextReads = [];
jest.unstable_mockModule('../../server/lib/location/coach-snapshot.js', () => ({
  readOwnedCoachSnapshot: async (...args) => {
    coachSnapshotReads.push(args);
    if (coachSnapshotError) throw coachSnapshotError;
    return coachSnapshot;
  },
}));
const settingsReceipt = { success: true, version: 8, hash: 'saved-settings-hash', changed: true, changes: [{ path: 'global.require_verified', label: 'Require Verified rider', before: true, after: false }] };
jest.unstable_mockModule('../../server/lib/offers/ruleset-writer.js', () => ({ saveOfferRules: async (...args) => { settingsWrites.push(args); if (settingsFailure) throw new Error(settingsFailure); return settingsReceipt; } }));

jest.unstable_mockModule('fs/promises', () => ({ appendFile, readFile }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.auth = { userId: USER, sessionId: 's1' }; next(); }, optionalAuth: (_r, _s, n) => n() }));
jest.unstable_mockModule('../../server/middleware/require-operator.js', () => ({ isOperator: () => false, requireOperator: (_r, _s, n) => n() }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: (_r, _s, n) => n(), verifySnapshotOwnership: async () => ({ ok: true, snapshot: ownedSource }) }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ voiceTurnsLimiter: (_r, _s, n) => n() }));
jest.unstable_mockModule('../../server/agent/enhanced-context.js', () => ({ getEnhancedProjectContext: async () => '' }));
const chain = () => { const c = {}; for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'insert', 'values', 'update', 'set']) c[m] = () => c; c.then = (res) => res([]); c.execute = async () => ({ rows: [] }); return c; };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: chain() }));
jest.unstable_mockModule('../../server/lib/ai/rideshare-coach-dal.js', () => ({ rideshareCoachDAL: {
  saveCoachOfferDecision: offerWrite, updateCoachOfferDecision: offerWrite, updateOfferIntelligence: offerWrite,
  resolveStrategyToSnapshot: async () => null,
  getCompleteContext: async (...args) => { contextReads.push(args); return currentContext; },
  getHeaderSnapshot: async () => currentContext?.sourceSnapshot ?? currentContext?.snapshot,
  getLatestStrategy: async () => currentContext?.strategy ?? null,
  getComprehensiveBriefing: async () => currentContext?.briefing ?? null,
  getOfferHistory: async () => ({ source_state: 'available', offers: [] }),
  generateMarketSlug: () => null,
  getSnapshotHistory: async () => snapshotHistory,
  formatContextForPrompt: () => '',
  extractAndSaveTips: async (...args) => { calls.tips.push(args); return 0; },
  saveConversationMessage: async (row) => { calls.history.push(row); return { id: `h-${calls.history.length}`, ...row }; },
  saveCoachMemo: async (data) => { calls.memo.push(data); if (memoBehavior === 'throw') throw new Error('memo table unavailable'); if (memoBehavior === 'null') return null; return { id: 'memo-0001-abcd', type: data.type, title: data.title, created_at: '2026-09-11T02:00:00.000Z' }; },
  saveUserNote: async (data) => { calls.note.push(data); noteHook?.(); return { id: 'note-1', ...data }; },
} }));
function responsesStream(events) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }));
}
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: async () => { throw new Error('not used'); }, callModelStream: async (_role, params) => { providerPrompts.push(params.system); providerHook?.(params); return responsesStream(providerEvents); } }));

const { default: router } = await import('../../server/api/chat/chat.js');
const app = express(); app.use(express.json()); app.use((_req, res, next) => { activeResponse = res; next(); }); app.use('/api/chat', router);

function sse(text) { return text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5).trim())); }
async function ask(message, extra = {}) {
  const res = await request(app).post('/api/chat').send({ message, snapshot: { timezone: 'America/Chicago' }, ...extra }).buffer(true).parse((r, cb) => { let s = ''; r.on('data', d => { s += d; }); r.on('end', () => cb(null, s)); });
  const events = sse(res.body);
  return { status: res.status, events, done: events.find(e => e.done), text: events.filter(e => e.delta).map(e => e.delta).join(''), raw: res.body };
}
const completed = (text) => [{ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: { status: 'completed', model: 'gpt-6-astra', output: [] } }];
const VALID_MEMO = '[COACH_MEMO: {"type":"bug","title":"Synthetic memo","detail":"Synthetic detail","priority":"medium"}]';
const assistantHistory = () => calls.history.filter(h => h.role === 'assistant');
beforeEach(() => { coachSnapshot = null; coachSnapshotError = null; ownedSource = null; coachSnapshotReads.length = 0; contextReads.length = 0; });

beforeEach(() => { settingsWrites.length = 0; settingsFailure = null; currentContext = null; snapshotHistory = []; providerHook = null; noteHook = null; providerPrompts.length = 0; calls.memo.length = 0; calls.note.length = 0; calls.history.length = 0; calls.tips.length = 0; appendFile.mockClear(); memoBehavior = 'ok'; providerEvents = []; jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); });

describe('POST /api/chat completion truthfulness (real router)', () => {
  const refresh = '[REFRESH_COACH_SNAPSHOT: {"reason":"The driver moved and needs nearby advice"}]';
  test('a completed refresh action returns a request, never a saved receipt or coordinates', async () => {
    providerEvents = completed(`A fresh location was requested. ${refresh}`);
    const result = await ask('I moved; update my location.');
    expect(result.done.actions_result).toMatchObject({ saved: 0, errors: [], coach_snapshot_refresh: { requested: true, reason: 'The driver moved and needs nearby advice' } });
    expect(result.done.response_text).not.toContain('[REFRESH_COACH_SNAPSHOT:');
    expect(assistantHistory()[0].content).toBe(result.done.response_text);
    expect(coachSnapshotReads).toHaveLength(0);
  });
  test('a JSON refresh action envelope shares the same completed-request contract', async () => {
    providerEvents = completed('```json\n' + JSON.stringify({ actions: [{ type: 'REFRESH_COACH_SNAPSHOT', data: { reason: 'Need current weather' } }], response: 'Requesting current conditions.' }) + '\n```');
    expect((await ask('What is it like here?')).done.actions_result.coach_snapshot_refresh).toEqual({ requested: true, reason: 'Need current weather' });
  });
  test.each([{ reason: ' ' }, { reason: 'Refresh', lat: 33, lng: -96 }, { reason: 'x'.repeat(501) }])('invalid refresh payload %j cannot trigger capture', async payload => {
    providerEvents = completed(`[REFRESH_COACH_SNAPSHOT: ${JSON.stringify(payload)}]`);
    const result = await ask('Refresh');
    expect(result.done.actions_result.coach_snapshot_refresh).toBeUndefined();
    expect(result.done.actions_result.errors.length).toBeGreaterThan(0);
  });
  test('duplicate refresh requests and answer-only turns cannot request device capture', async () => {
    providerEvents = completed(refresh + ' ' + refresh);
    expect((await ask('Refresh')).done.actions_result.coach_snapshot_refresh).toBeUndefined();
    providerEvents = completed(refresh);
    const result = await ask('Continue', { answerOnly: true });
    expect(result.done.actions_result.coach_snapshot_refresh).toBeUndefined();
    expect(result.done.actions_result.errors.join(' ')).toContain('answer-only');
  });
  test('an interrupted refresh response has no action result', async () => {
    providerEvents = [{ type: 'response.output_text.delta', delta: refresh }, { type: 'response.incomplete', response: { model: 'gpt-6-astra' } }];
    const result = await ask('Refresh');
    expect(result.done.error).toBeDefined(); expect(result.done.actions_result).toBeUndefined();
  });
  test.each(['LOG_OFFER_DECISION', 'UPDATE_OFFER_DECISION', 'BACKFILL_OFFER_INTEL'])('legacy %s tags cannot write or overwrite Analyzer evidence', async tag => {
    providerEvents = completed(`Saved. [${tag}: {"id":"11111111-1111-4111-8111-111111111111","offer_intelligence_id":"11111111-1111-4111-8111-111111111111","ai_recommendation":"ACCEPT","ai_reasoning":"fabricated","user_decision":"Completed","price":900}]`);
    const result = await ask('Explain this saved offer.');
    expect(offerWrite).not.toHaveBeenCalled();
    expect(result.done.actions_result.saved).toBe(0);
    expect(result.done.response_text).toContain('Coach offer writes are disabled');
    expect(result.done.response_text).toContain('Not saved');
    expect(result.done.response_text).not.toContain(`[${tag}:`);
  });
  test('Coach consumes current saved rules and selections without reading architecture documents', async () => {
    currentContext = { snapshot: { snapshot_id: 'snap-1', timezone: 'America/Chicago' },
      offerRules: { source_state: 'saved', version: 7, hash: 'current-owner-rules', config: { basis: 'active_time' } },
      driverProfile: { selected_services: ['comfort'] }, driverVehicle: { model: 'Saved vehicle' } };
    providerEvents = completed('These are your saved settings.');
    await ask('Which settings do I have?', { snapshotId: 'snap-1' });
    expect(providerPrompts[0]).toContain('current-owner-rules');
    expect(providerPrompts[0]).toContain('selected_services');
    expect(providerPrompts[0]).toContain('Saved vehicle');
    expect(providerPrompts[0]).not.toContain('STALE_DOCUMENT_MUST_NOT_ENTER_COACH');
    expect(readFile).not.toHaveBeenCalled();
    expect(providerPrompts[0]).toContain('navigation_context.items[].directions_url');
    expect(providerPrompts[0]).toContain('/maps/dir/?api=1&destination=');
    expect(providerPrompts[0]).not.toContain('/maps/search/?api=1&query=');
    expect(providerPrompts[0]).toContain('Label venue sites Website and evidence links Source');
  });
  test('answer-only reconciliation blocks model-emitted action tags and automatic learning on the server', async () => {
    providerEvents = completed('I saved it. ' + VALID_MEMO + ' [SAVE_NOTE: {"type":"preference","title":"Synthetic preference","content":"Do not save this","importance":50}]');
    const r = await ask('Reconcile my latest continuation', { answerOnly: true });
    expect(r.status).toBe(200);
    expect(calls.memo).toHaveLength(0); expect(calls.note).toHaveLength(0); expect(calls.tips).toHaveLength(0);
    expect(appendFile).not.toHaveBeenCalled();
    expect(r.done.actions_result.saved).toBe(0);
    expect(r.done.actions_result.errors.join(' ')).toContain('answer-only');
    expect(r.done.response_text).toContain('Not saved');
    expect(providerPrompts[0]).toContain('ANSWER-ONLY RECONCILIATION');
    expect(assistantHistory()).toHaveLength(1);
  });
  test('answer-only responses without action tags also skip automatic tip extraction', async () => {
    providerEvents = completed('The saved briefing is still pending.');
    const r = await ask('What data is available?', { answerOnly: true });
    expect(r.done.done).toBe(true); expect(calls.tips).toHaveLength(0);
    expect(assistantHistory()[0].content).toBe('The saved briefing is still pending.');
  });
  test('responds before Strategy finishes and rereads later saved evidence on the next turn', async () => {
    currentContext = {
      snapshot: { snapshot_id: 'snap-1', timezone: 'America/Chicago', source_record: { snapshot_id: 'snap-1', timezone: 'America/Chicago', weather: { tempF: 71 } } },
      strategy: null, status: 'pending_strategy',
      briefing: { source_record: { status: 'pending', events: null, news: { title: 'Saved early news' } } },
      offerHistory: { source_state: 'available', offers: [{ id: 'o1', decision: 'ACCEPT', parsed_data_json: { phase: 1 } }] },
    };
    providerEvents = completed('I can discuss the saved news while Strategy is pending.');
    const early = await ask('What is known so far?', { snapshotId: 'snap-1' });
    if (early.status !== 200) throw new Error(early.raw);
    expect(early).toMatchObject({ status: 200, done: { done: true } });
    expect(providerPrompts[0]).toContain('Saved early news');
    expect(providerPrompts[0]).toContain('"strategy": null');
    currentContext = { ...currentContext, strategy: { status: 'failed', updated_at: '2026-09-11T08:02:00Z', strategy_for_now: 'Earlier partial text' }, offerHistory: { source_state: 'available', offers: [{ id: 'o1', decision: 'ACCEPT', parsed_data_json: { phase: 2, evidence: 'Saved later sweep' } }] } };
    await ask('What changed?', { snapshotId: 'snap-1' });
    expect(providerPrompts[1]).toContain('Saved later sweep');
    expect(providerPrompts[1]).toContain('"status": "failed"');
    expect(providerPrompts[1]).toContain('2026-09-11T08:02:00Z');
    expect(providerPrompts[1]).toContain('never OCR a new offer or issue a new ACCEPT/REJECT/CANCEL');
  });
  test('valid memo tag then provider interruption: zero writes, explicit failure, no assistant history', async () => {
    providerEvents = [{ type: 'response.output_text.delta', delta: `Saved your report. ${VALID_MEMO}` }, { type: 'response.incomplete', response: { model: 'gpt-6-astra' } }];
    const r = await ask('please remember this bug');
    expect(r.status).toBe(200);
    expect(calls.memo).toHaveLength(0);
    expect(appendFile).not.toHaveBeenCalled();
    expect(r.done).toMatchObject({ done: true });
    expect(typeof r.done.error).toBe('string');
    expect(r.done.actions_result).toBeUndefined();
    expect(assistantHistory()).toHaveLength(0);
  });

  test('completed provider with malformed action JSON: zero writes, reported parse failure, truthful final text and history', async () => {
    providerEvents = completed('Saved your report. [COACH_MEMO: {"type":"bug","title":"Synthetic issue","detail":"Synthetic detail",}]');
    const r = await ask('note this');
    expect(calls.memo).toHaveLength(0);
    expect(r.done.actions_result.saved).toBe(0);
    expect(r.done.actions_result.errors).toEqual([expect.stringMatching(/^COACH_MEMO: malformed action JSON/)]);
    expect(r.done.response_text).toMatch(/Saved your report\./);
    expect(r.done.response_text).toMatch(/⚠️ Not saved: COACH_MEMO: malformed action JSON/);
    expect(r.done.response_text).not.toMatch(/\[COACH_MEMO/);
    expect(r.text).toMatch(/⚠️ Not saved:/);
    const [saved] = assistantHistory();
    expect(saved.content).toBe(r.done.response_text);
  });

  test.each(['throw', 'null'])('completed provider, valid tag, DAL %s: no receipt, explicit write failure, truthful history', async (mode) => {
    memoBehavior = mode; providerEvents = completed(`Logged it. ${VALID_MEMO}`);
    const r = await ask('remember');
    expect(calls.memo).toHaveLength(1);
    expect(r.done.actions_result.saved).toBe(0);
    expect(r.done.actions_result.memos ?? []).toHaveLength(0);
    expect(r.done.actions_result.errors).toEqual([expect.stringMatching(/^CoachMemo: /)]);
    expect(appendFile).not.toHaveBeenCalled();
    expect(r.done.response_text).toMatch(/⚠️ Not saved: CoachMemo:/);
    expect(assistantHistory()[0].content).toBe(r.done.response_text);
  });

  test('confirmed row: one write with authenticated ownership, one exact receipt, consistent final and history text', async () => {
    providerEvents = completed(`Logged it. ${VALID_MEMO} Anything else?`);
    const r = await ask('remember');
    expect(calls.memo).toHaveLength(1);
    expect(calls.memo[0]).toMatchObject({ triggering_user_id: USER, title: 'Synthetic memo' });
    expect(r.done.actions_result).toMatchObject({ saved: 1, errors: [] });
    expect(r.done.actions_result.memos).toEqual([{ id: 'memo-0001-abcd', type: 'bug', title: 'Synthetic memo', created_at: '2026-09-11T02:00:00.000Z' }]);
    expect(r.done.response_text).toBe('Logged it.  Anything else?');
    expect(r.done.response_text).not.toMatch(/Not saved/);
    expect(assistantHistory()[0].content).toBe(r.done.response_text);
    expect(assistantHistory()[0].user_id).toBe(USER);
  });

  test('mixed: a confirmed note plus a malformed memo keeps the receipt and describes the failure', async () => {
    providerEvents = completed('Done. [SAVE_NOTE: {"title":"Airport tip","content":"Stage at the cell lot"}] [COACH_MEMO: {"type":"bug",}]');
    const r = await ask('save both');
    expect(calls.note).toHaveLength(1);
    expect(calls.memo).toHaveLength(0);
    expect(r.done.actions_result.saved).toBe(1);
    expect(r.done.actions_result.errors).toEqual([expect.stringMatching(/^COACH_MEMO: malformed/)]);
    expect(r.done.response_text).toMatch(/^Done\./);
    expect(r.done.response_text).toMatch(/Not saved: COACH_MEMO/);
    expect(assistantHistory()[0].content).toBe(r.done.response_text);
  });

  test('mixed: a confirmed memo retains its exact receipt when another action fails to parse', async () => {
    providerEvents = completed(`Done. ${VALID_MEMO} [SAVE_NOTE: {"title":"Airport tip",}]`);
    const r = await ask('save both');
    expect(calls.memo).toHaveLength(1);
    expect(calls.note).toHaveLength(0);
    expect(r.done.actions_result.saved).toBe(1);
    expect(r.done.actions_result.memos).toEqual([{ id: 'memo-0001-abcd', type: 'bug', title: 'Synthetic memo', created_at: '2026-09-11T02:00:00.000Z' }]);
    expect(r.done.actions_result.errors).toEqual([expect.stringMatching(/^SAVE_NOTE: malformed/)]);
    expect(r.done.response_text).toMatch(/Not saved: SAVE_NOTE/);
    expect(assistantHistory()[0].content).toBe(r.done.response_text);
  });
});


describe('Coach authoritative context and request lifecycle', () => {
  const coachId = '22222222-2222-4222-8222-222222222222';
  test('explicit Coach observation and stable saved source are independently loaded without changing the thread source', async () => {
    coachSnapshot = { snapshot_id: coachId, city: 'Los Angeles', state: 'CA', timezone: 'America/Los_Angeles' };
    currentContext = { snapshot: coachSnapshot, sourceSnapshot: { snapshot_id: 'source-1', timezone: 'America/Chicago', city: 'Dallas' },
      savedContextSource: { snapshot_id: 'source-1', coach_snapshot_id: coachId, geography_matches: false },
      briefing: { source_record: { snapshot_id: 'source-1', status: 'pending', news: { title: 'Original Dallas news' } } } };
    providerEvents = completed('I have current location and historical Dallas evidence.');
    const result = await ask('Where should I go?', { snapshotId: 'source-1', coachSnapshotId: coachId });
    expect(result.status).toBe(200);
    expect(coachSnapshotReads).toEqual([[{ userId: USER, sessionId: 's1' }, coachId]]);
    expect(contextReads[0]).toEqual(['source-1', null, USER, { coachSnapshot }]);
    expect(providerPrompts[0]).toContain('America/Los_Angeles');
    expect(providerPrompts[0]).toContain('"source_snapshot"');
    expect(providerPrompts[0]).toContain('Original Dallas news');
    expect(assistantHistory()[0]).toMatchObject({ snapshot_id: 'source-1', location_context: { city: 'Los Angeles', coach_snapshot_id: coachId } });
  });
  test('Coach-only chat and summary need no MAIN source or implied Strategy generation', async () => {
    coachSnapshot = { snapshot_id: coachId, timezone: 'America/Chicago' };
    currentContext = { snapshot: coachSnapshot, briefing: { exists: false }, status: 'coach_context' };
    providerEvents = completed('I can help from the Coach location.');
    expect((await ask('Help me here', { coachSnapshotId: coachId })).status).toBe(200);
    expect(contextReads[0]).toEqual([null, null, USER, { coachSnapshot }]);
    expect(assistantHistory()[0].snapshot_id).toBeNull();
    const summary = await request(app).get(`/api/chat/context/${coachId}?summary=1&coachSnapshotId=${coachId}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ coach_snapshot_id: coachId, source_snapshot_id: null, strategy: { state: 'missing' }, briefing: { state: 'missing' } });
  });
  test.each(['foreign owner', 'previous session', 'wrong purpose'])('rejected Coach identity (%s) fails before context, model and history', async reason => {
    coachSnapshotError = Object.assign(new Error(reason), { status: 409, code: 'coach_snapshot_unavailable' });
    const result = await request(app).post('/api/chat').send({ message: 'Where am I?', coachSnapshotId: coachId });
    expect(result.status).toBe(409);
    expect(contextReads).toHaveLength(0); expect(providerPrompts).toHaveLength(0); expect(calls.history).toHaveLength(0);
  });
  test('Coach-purpose source ID still validates the live session and cannot fall back to the browser timezone on failure', async () => {
    ownedSource = { snapshot_id: coachId, permissions: { context_kind: 'coach' } };
    coachSnapshotError = Object.assign(new Error('Session expired'), { status: 409, code: 'coach_snapshot_unavailable' });
    const result = await request(app).post('/api/chat').send({ message: 'Help here', snapshotId: coachId, snapshot: { timezone: 'Asia/Tokyo' } });
    expect(result.status).toBe(409); expect(coachSnapshotReads).toHaveLength(1);
    expect(providerPrompts).toHaveLength(0); expect(calls.history).toHaveLength(0);
  });
  test('a verified Coach-purpose source ID becomes current location with no fabricated guidance source', async () => {
    ownedSource = { snapshot_id: coachId, permissions: { context_kind: 'coach' } };
    coachSnapshot = { ...ownedSource, timezone: 'America/Los_Angeles' };
    currentContext = { snapshot: coachSnapshot, status: 'coach_context' };
    providerEvents = completed('Current Coach location is available.');
    expect((await ask('Help here', { snapshotId: coachId })).status).toBe(200);
    expect(contextReads[0]).toEqual([null, null, USER, { coachSnapshot }]);
    expect(providerPrompts[0]).toContain('America/Los_Angeles');
  });
  test('a composed Coach context read failure cannot fall back to browser timezone or strategy', async () => {
    coachSnapshot = { snapshot_id: coachId, timezone: 'America/Los_Angeles' };
    currentContext = { snapshot: null, status: 'error' };
    const result = await request(app).post('/api/chat').send({ message: 'Help here', coachSnapshotId: coachId, snapshot: { timezone: 'Asia/Tokyo' }, strategy: 'Unverified client guidance' });
    expect(result.status).toBe(503); expect(providerPrompts).toHaveLength(0); expect(calls.history).toHaveLength(0);
  });
  test.each([{}, [], 42, 'not-a-uuid', ''])('malformed Coach identity %j is rejected before any lookup', async coachSnapshotId => {
    expect((await request(app).post('/api/chat').send({ message: 'Where am I?', coachSnapshotId })).status).toBe(400);
    expect(coachSnapshotReads).toHaveLength(0); expect(providerPrompts).toHaveLength(0);
  });
  test('history keeps both DST fold instants distinct in the historical snapshot timezone', async () => {
    currentContext = { snapshot: { snapshot_id: 'current', timezone: 'Asia/Tokyo' } };
    snapshotHistory = [
      { created_at: '2026-11-01T05:30:00Z', timezone: 'America/New_York', city: 'First fold', state: 'NY' },
      { created_at: '2026-11-01T06:30:00Z', timezone: 'America/New_York', city: 'Second fold', state: 'NY' },
    ];
    providerEvents = completed('Historical context.');
    await ask('When did I drive?', { snapshotId: 'current' });
    const history = providerPrompts[0].split('Recent Session History')[1];
    expect(history).toMatch(/1:30 AM GMT-04:00.*America\/New_York.*First fold/);
    expect(history).toMatch(/1:30 AM GMT-05:00.*America\/New_York.*Second fold/);
    expect(history).toContain('2026-11-01T05:30:00.000Z');
    expect(history).toContain('2026-11-01T06:30:00.000Z');
  });
  test('history keeps its own local calendar date across a UTC midnight', async () => {
    snapshotHistory = [{ created_at: '2026-01-02T00:30:00Z', timezone: 'America/Los_Angeles', city: 'Calendar fixture', state: 'CA' }];
    providerEvents = completed('Historical context.');
    await ask('When did I drive?');
    const history = providerPrompts[0].split('Recent Session History')[1];
    expect(history).toMatch(/Jan 1, 2026.*4:30 PM GMT-08:00.*America\/Los_Angeles.*Calendar fixture/);
  });
  test.each([null, 'Invalid/Fixture'])('unknown saved history zone %s stays unknown without borrowing current or server time', async timezone => {
    snapshotHistory = [{ created_at: '2026-01-02T00:30:00Z', timezone, city: 'Unknown zone fixture', state: 'XX' }];
    providerEvents = completed('Historical context.');
    await ask('When did I drive?');
    const line = providerPrompts[0].split('\n').find(value => value.includes('Unknown zone fixture'));
    expect(line).toContain('Local time unavailable');
    expect(line).toContain('2026-01-02T00:30:00.000Z');
    expect(line).not.toMatch(/\d:\d\d [AP]M/);
  });
  test.each([null, 'invalid-date', '2026-11-01T01:30:00'])('invalid or ambiguous saved history instant %s stays unknown without dropping valid history', async created_at => {
    snapshotHistory = [
      { created_at, timezone: 'America/New_York', city: 'Unknown time fixture', state: 'NY' },
      { created_at: '2026-01-02T00:30:00Z', timezone: 'America/Los_Angeles', city: 'Valid time fixture', state: 'CA' },
    ];
    providerEvents = completed('Historical context.');
    await ask('When did I drive?');
    const lines = providerPrompts[0].split('\n');
    expect(lines.find(line => line.includes('Unknown time fixture'))).toContain('Saved timestamp unavailable');
    expect(lines.find(line => line.includes('Valid time fixture'))).toMatch(/Jan 1, 2026.*4:30 PM GMT-08:00/);
  });
  test('saved snapshot timezone supersedes a conflicting client copy', async () => {
    currentContext = { snapshot: { snapshot_id: 'snap-1', timezone: 'America/Chicago' } };
    providerEvents = completed('Saved context.');
    const result = await ask('What time is it?', { snapshotId: 'snap-1', snapshot: { timezone: 'Asia/Tokyo' } });
    expect(result.status).toBe(200);
    expect(providerPrompts[0]).not.toContain('Asia/Tokyo');
    expect(providerPrompts[0]).toContain('America/Chicago');
  });
  test('missing timezone on a saved snapshot cannot be replaced by a client claim', async () => {
    currentContext = { snapshot: { snapshot_id: 'snap-1', timezone: null } };
    const result = await request(app).post('/api/chat').send({ message: 'What time is it?', snapshotId: 'snap-1', snapshot: { timezone: 'Asia/Tokyo' } });
    expect(result.status).toBe(400);
    expect(providerPrompts).toHaveLength(0);
  });
  test.each([{ conversationId: {} }, { conversationId: ['wrong'] }, { threadHistory: null }, { attachments: {} }])('malformed request shape returns 400 before persistence or model use: %j', async extra => {
    const result = await request(app).post('/api/chat').send({ message: 'Question', snapshot: { timezone: 'America/Chicago' }, ...extra });
    expect(result.status).toBe(400);
    expect(calls.history).toHaveLength(0);
    expect(providerPrompts).toHaveLength(0);
  });
  test('provider completion after transport cancellation cannot execute actions or learn tips', async () => {
    providerHook = () => activeResponse.emit('close');
    providerEvents = completed('Saved. ' + VALID_MEMO);
    await ask('Remember a bug.');
    expect(calls.memo).toHaveLength(0);
    expect(calls.tips).toHaveLength(0);
    expect(assistantHistory()).toHaveLength(0);
  });
  test('disconnect during a committed action stops subsequent actions and automatic learning', async () => {
    noteHook = () => activeResponse.emit('close');
    providerEvents = completed('Saved. [SAVE_NOTE: {"title":"Synthetic note","content":"Synthetic content"}] ' + VALID_MEMO);
    await ask('Remember both.');
    expect(calls.note).toHaveLength(1);
    expect(calls.memo).toHaveLength(0);
    expect(calls.tips).toHaveLength(0);
    expect(assistantHistory()).toHaveLength(0);
  });
});


describe('Coach directed Offer Analyzer settings action (real completion path)', () => {
  const action = '[UPDATE_OFFER_RULES: {"reason":"Driver requested tuning from saved offers", "changes":[{"path":"global.require_verified","value":false}]}]';
  const verifiedContext = () => ({ snapshot: { snapshot_id: 'snap-1', timezone: 'America/Chicago' },
    offerRules: { source_state: 'saved', version: 7, hash: 'current-owner-rules', config: { global: { require_verified: true } } } });
  test('directed tuning returns a durable receipt and passes authenticated session plus server-read revision/hash', async () => {
    currentContext = verifiedContext(); providerEvents = completed('I tuned your requested settings. ' + action);
    const result = await ask('Review my saved offers and tune my settings', { snapshotId: 'snap-1', userId: 'model-cannot-select-owner' });
    expect(settingsWrites).toHaveLength(1);
    expect(settingsWrites[0][0]).toEqual({ userId: USER, sessionId: 's1' });
    expect(settingsWrites[0][1]).toEqual({ expected_version: 7 });
    expect(settingsWrites[0][2]).toMatchObject({ expectedHash: 'current-owner-rules', transform: expect.any(Function), signal: expect.any(AbortSignal) });
    expect(result.done.actions_result).toMatchObject({ saved: 1, errors: [], offer_rules: { version: 8, hash: 'saved-settings-hash', changed: true, changes: settingsReceipt.changes } });
    expect(result.done.response_text).not.toContain('[UPDATE_OFFER_RULES:');
    expect(result.done.response_text).toContain('Offer Analyzer settings saved.');
    expect(result.done.response_text).toContain('Require Verified rider: On → Off');
    expect(assistantHistory()[0].content).toBe(result.done.response_text);
    expect(providerPrompts[0]).toContain('Reviewing offers, giving advice');
    expect(providerPrompts[0]).toContain('does not require the driver to choose every numeric value');
  });
  test('ordinary review has no action or settings write', async () => {
    currentContext = verifiedContext(); providerEvents = completed('The saved offers show a pattern worth considering.');
    const result = await ask('Review my saved offers', { snapshotId: 'snap-1' });
    expect(settingsWrites).toHaveLength(0);
    expect(result.done.actions_result).toBeUndefined();
  });
  test.each(['invalid', 'read_failed', 'unavailable'])('unverified %s context rejects an emitted settings action', async source_state => {
    currentContext = verifiedContext(); currentContext.offerRules.source_state = source_state;
    providerEvents = completed('Saved. ' + action);
    const result = await ask('Tune my settings', { snapshotId: 'snap-1' });
    expect(settingsWrites).toHaveLength(0);
    expect(result.done.actions_result.offer_rules).toBeUndefined();
    expect(result.done.response_text).toContain('could not be verified');
  });
  test('a stale canonical write reports not saved without a receipt or retry', async () => {
    currentContext = verifiedContext(); settingsFailure = 'Your rules were changed elsewhere'; providerEvents = completed('Saved. ' + action);
    const result = await ask('Tune my settings', { snapshotId: 'snap-1' });
    expect(settingsWrites).toHaveLength(1);
    expect(result.done.actions_result).toMatchObject({ saved: 0, errors: [expect.stringContaining('changed elsewhere')] });
    expect(result.done.actions_result.offer_rules).toBeUndefined();
    expect(result.done.response_text).toContain('Not saved');
  });
  test.each(['answer-only', 'incomplete', 'duplicate', 'invalid-value', 'injected-owner'])('%s never saves settings', async mode => {
    currentContext = verifiedContext();
    const text = mode === 'duplicate' ? action + action : mode === 'invalid-value' ? action.replace('false', '"false"') : mode === 'injected-owner' ? action.replace('{"reason"', '{"user_id":"another-owner","reason"') : action;
    providerEvents = mode === 'incomplete' ? [{ type: 'response.output_text.delta', delta: text }, { type: 'response.incomplete', response: { model: 'gpt-6-astra' } }] : completed(text);
    const result = await ask('Tune my settings', { snapshotId: 'snap-1', ...(mode === 'answer-only' && { answerOnly: true }) });
    expect(settingsWrites).toHaveLength(0);
    expect(result.done.actions_result?.offer_rules).toBeUndefined();
  });
});
