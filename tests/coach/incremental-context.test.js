import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getCoachContextProgress, describeStrategyStatus } from '../../server/lib/ai/coach-context-progress.js';
import { formatCoachSourceContext } from '../../server/lib/ai/coach-source-context.js';

let rows = [], failure = false;
const selected = [], predicates = [], limits = [];
const db = { select: fields => {
  selected.push(fields);
  const chain = { from: () => chain, where: predicate => { predicates.push(new PgDialect().sqlToQuery(predicate)); return chain; }, orderBy: () => chain, limit: async limit => {
    limits.push(limit); if (failure) throw new Error('synthetic read failure'); return rows;
  } };
  return chain;
} };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const { RideshareCoachDAL } = await import('../../server/lib/ai/rideshare-coach-dal.js');
const dal = new RideshareCoachDAL();
beforeEach(() => { rows = []; failure = false; selected.length = 0; predicates.length = 0; limits.length = 0; });

describe('Coach persisted source updates', () => {
  test('snapshot evidence stays intact without inventing Sunday or midnight for missing data', async () => {
    rows = [{ snapshot_id: 'snap', user_id: 'alice', created_at: '2026-09-11T08:00:00Z', lat: 1, lng: 2, dow: null, hour: null }];
    const snapshot = await dal.getHeaderSnapshot('snap');
    expect(selected).toHaveLength(1);
    expect(snapshot.source_record).toEqual(rows[0]);
    expect(snapshot).toMatchObject({ dow: null, hour: null, day_of_week: 'Unknown', lat: 1, lng: 2 });
    expect(getCoachContextProgress({ snapshot }).snapshot.state).toBe('partial');
  });
  test('each owned offer read includes the later sweep without changing its original decision', async () => {
    rows = [{ id: 'offer-a', decision: 'ACCEPT', per_mile: '0', created_at: '2026-09-11T08:00:00Z', updated_at: '2026-09-11T08:00:00Z', parsed_data_json: { phase: 1 } }];
    const early = await dal.getOfferHistory('alice');
    rows = [{ ...rows[0], updated_at: '2026-09-11T08:02:00Z', parsed_data_json: { phase: 2, venue_context: 'saved second sweep' }, raw_ai_response: '{"reason":"stored analysis"}' }];
    const later = await dal.getOfferHistory('alice');
    expect(early.offers[0].parsed_data_json.phase).toBe(1);
    expect(later.offers[0]).toMatchObject({ decision: 'ACCEPT', parsed_data_json: { phase: 2 }, raw_ai_response: '{"reason":"stored analysis"}' });
    expect(later.stats.avg_per_mile).toBe('0.00');
    expect(predicates).toHaveLength(2);
    expect(predicates.every(p => p.sql.includes('user_id') && p.params[0] === 'alice')).toBe(true);
    expect(selected).toEqual([undefined, undefined]);
    expect(limits).toEqual([20, 20]);
    const prompt = formatCoachSourceContext({ created_at: rows[0].created_at }, { source_record: { status: 'pending', news: { title: 'already saved' }, events: null } }, { strategy: null, offerHistory: later });
    expect(prompt).toContain('saved second sweep');
    expect(prompt).toContain('already saved');
    expect(prompt).toContain('"events": null');
    expect(prompt).toContain('never OCR a new offer or issue a new ACCEPT/REJECT/CANCEL');
  });

  test('empty history, read failure and absent owner are distinct', async () => {
    expect(await dal.getOfferHistory('alice')).toMatchObject({ source_state: 'available', offers: [] });
    failure = true;
    expect(await dal.getOfferHistory('alice')).toMatchObject({ source_state: 'read_failed', offers: [] });
    const reads = selected.length;
    expect(await dal.getOfferHistory(null)).toMatchObject({ source_state: 'unavailable' });
    expect(selected).toHaveLength(reads);
  });

  test('full Strategy survives independently of Briefing and records actual update time', async () => {
    rows = [{ id: 's', snapshot_id: 'snap', created_at: '2026-09-11T07:00:00Z', updated_at: '2026-09-11T08:00:00Z', status: 'failed', phase: 'venues', error_message: 'saved failure', strategy_for_now: 'Earlier partial text' }];
    const strategy = await dal.getLatestStrategy('snap');
    expect(selected).toHaveLength(1);
    expect(strategy).toMatchObject({ phase: 'venues', error_message: 'saved failure', strategy_timestamp: '2026-09-11T08:00:00.000Z' });
    expect(describeStrategyStatus(strategy)).toBe('Generation failed — last updated 2026-09-11T08:00:00.000Z');
    const progress = getCoachContextProgress({ strategy, briefing: { exists: true, status: 'pending' }, offerHistory: { source_state: 'read_failed' } }, '2026-09-11T09:00:00Z');
    expect(progress.strategy).toMatchObject({ state: 'failed', created_at: '2026-09-11T07:00:00.000Z', updated_at: '2026-09-11T08:00:00.000Z' });
    expect(progress.read_at).toBe('2026-09-11T09:00:00.000Z');
    expect(progress.briefing.state).toBe('partial');
    expect(progress.offers.state).toBe('read_failed');
    failure = true;
    expect((await dal.getLatestStrategy('snap')).source_state).toBe('read_failed');
  });
});
