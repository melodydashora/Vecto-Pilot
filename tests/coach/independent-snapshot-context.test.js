const { structuredClone } = globalThis;
import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';
import { formatCoachSourceContext } from '../../server/lib/ai/coach-source-context.js';

let sourceRow;
const snapshotReads = [];
const db = { select: () => {
  const query = { from: () => query, where: predicate => { snapshotReads.push(predicate); return query; }, limit: async () => sourceRow ? [sourceRow] : [] };
  return query;
} };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const { RideshareCoachDAL } = await import('../../server/lib/ai/rideshare-coach-dal.js');
let dal, coach, briefing, strategy;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-13T06:00:00Z') });
  snapshotReads.length = 0;
  sourceRow = { snapshot_id: 'source-id', user_id: 'owner', session_id: 'session',
    created_at: '2026-10-11T10:00:00Z', city: 'Dallas', state: 'TX', country: 'US', timezone: 'America/Chicago',
    lat: 33, lng: -96, dow: 0, hour: 5, day_part_key: 'overnight', weather: { tempF: 80 } };
  coach = { ...sourceRow, snapshot_id: 'coach-id', created_at: '2026-10-13T05:59:59Z',
    city: 'Los Angeles', state: 'CA', timezone: 'America/Los_Angeles', lat: 34, lng: -118,
    dow: 1, hour: 22, weather: { tempF: 60 }, permissions: { context_kind: 'coach', observed_at: '2026-10-13T05:59:58Z' } };
  briefing = { exists: true, status: 'complete', generated_at: '2026-10-11T10:01:00Z',
    source_record: { snapshot_id: 'source-id', generation_token: 'original-generation', status: 'complete',
      generated_at: '2026-10-11T10:01:00Z', weather_current: { tempF: 80 },
      school_closures: [{ schoolName: 'Dallas fixture district', closureStart: '2026-10-09', reopeningDate: '2026-10-13' }] } };
  strategy = { snapshot_id: 'source-id', strategy_for_now: 'Earlier Dallas guidance', status: 'ok', created_at: '2026-10-11T10:02:00Z' };
  dal = new RideshareCoachDAL();
  const results = { getLatestStrategy: strategy, getComprehensiveBriefing: briefing,
    getSmartBlocks: [{ name: 'Saved Dallas destination', coordinates: { lat: 33, lng: -96 }, distance_miles: 2 }],
    getFeedback: { venue_feedback: [], strategy_feedback: [] }, getVenueData: { venues: [] }, getActions: [],
    getMarketIntelligence: { marketPosition: null, intelligence: [] }, getUserNotes: [],
    getDriverProfile: { profile: { user_id: 'owner' }, vehicle: null }, getOfferHistory: { source_state: 'available', offers: [] },
    getCoachOfferDecisions: { decisions: [] }, getCoachMemosForContext: [], getCoachSystemNotesForContext: [],
    getOfferPatterns: null, getOfferRules: { source_state: 'unavailable', config: null } };
  for (const [method, result] of Object.entries(results)) jest.spyOn(dal, method).mockResolvedValue(result);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('independent Coach observation and saved source composition', () => {
  test('current market uses Coach coordinates and city; all saved guidance keeps its original source identity', async () => {
    const originals = structuredClone({ sourceRow, coach, briefing, strategy });
    const context = await dal.getCompleteContext('source-id', null, 'owner', { coachSnapshot: coach });
    expect(context.snapshot.source_record).toEqual(originals.coach);
    expect(context.sourceSnapshot.source_record).toEqual(originals.sourceRow);
    expect(context.briefing).toEqual(originals.briefing); expect(context.strategy).toEqual(originals.strategy);
    expect(dal.getLatestStrategy).toHaveBeenCalledWith('source-id');
    expect(dal.getSmartBlocks).toHaveBeenCalledWith('source-id');
    expect(dal.getMarketIntelligence).toHaveBeenCalledWith('Los Angeles', 'CA');
    expect(snapshotReads).toHaveLength(1);
    expect(context.savedContextSource).toMatchObject({ source_state: 'historical_saved_context', snapshot_id: 'source-id',
      coach_snapshot_id: 'coach-id', geography_matches: false, briefing_generation_token: 'original-generation',
      location: { city: 'Dallas', timezone: 'America/Chicago' } });
    expect(context.progress.snapshot).toMatchObject({ observed_at: coach.permissions.observed_at.replace('Z', '.000Z'), timezone: 'America/Los_Angeles' });
    expect(context.progress.strategy.timezone).toBe('America/Chicago');
    expect(context.progress.briefing.timezone).toBe('America/Chicago');
    expect({ sourceRow, coach, briefing, strategy }).toEqual(originals);
  });

  test('calendar uses current Coach local date without claiming old-city dates apply nearby', async () => {
    const context = await dal.getCompleteContext('source-id', null, 'owner', { coachSnapshot: coach });
    const prompt = formatCoachSourceContext(context.snapshot, context.briefing, context);
    const data = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.indexOf('\n=== END SAVED SOURCE RECORDS ===')));
    expect(data.school_calendar_context).toMatchObject({ local_date: '2026-10-12', timezone: 'America/Los_Angeles',
      geography_matches: false, source_snapshot_id: 'source-id', source_location: { city: 'Dallas' },
      items: [{ status: 'closed', student_return_date: '2026-10-13' }] });
    expect(data.snapshot).toEqual(coach); expect(data.source_snapshot).toEqual(sourceRow);
    expect(data.briefing).toEqual(briefing.source_record);
    expect(prompt).toContain('A different source city does not establish');
  });

  test('Coach-only context does not query or imply a generated MAIN source', async () => {
    const context = await dal.getCompleteContext(null, null, 'owner', { coachSnapshot: coach });
    expect(snapshotReads).toHaveLength(0);
    expect(dal.getLatestStrategy).not.toHaveBeenCalled(); expect(dal.getComprehensiveBriefing).not.toHaveBeenCalled();
    expect(context).toMatchObject({ status: 'coach_context', snapshot: { snapshot_id: 'coach-id' }, sourceSnapshot: null,
      savedContextSource: { source_state: 'unavailable', snapshot_id: null }, smartBlocks: [] });
    expect(context.progress.strategy.state).toBe('missing'); expect(context.progress.briefing.state).toBe('missing');
    const prompt = dal.formatContextForPrompt(context);
    expect(prompt).not.toContain('is generating'); expect(prompt).not.toContain('are being generated');
  });

  test('even a same-city refresh keeps the earlier guidance timestamps rather than promoting freshness', async () => {
    coach = { ...coach, city: 'Dallas', state: 'TX', timezone: 'America/Chicago' };
    const context = await dal.getCompleteContext('source-id', null, 'owner', { coachSnapshot: coach });
    expect(context.savedContextSource).toMatchObject({ geography_matches: true, source_state: 'historical_saved_context', observed_at: '2026-10-11T10:00:00.000Z' });
    expect(dal.formatContextForPrompt(context)).toContain('HISTORICAL SAVED GUIDANCE SOURCE');
  });
  test('unavailable source location retains its explicit ID and never borrows the Coach timezone for old guidance', async () => {
    sourceRow = null;
    const context = await dal.getCompleteContext('source-id', null, 'owner', { coachSnapshot: coach });
    expect(context.savedContextSource).toMatchObject({ source_state: 'unavailable', snapshot_id: 'source-id', geography_matches: null, location: null });
    expect(context.progress.strategy.timezone).toBeNull(); expect(context.progress.briefing.timezone).toBeNull();
    expect(context.briefing.source_record.snapshot_id).toBe('source-id');
  });
});
