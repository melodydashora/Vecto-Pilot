// tests/strategy/tactical-planner-cache.test.js
//
// Workstream 6 Step 3 — catalog-first cache enforcement tests.
// Verifies resolveVenueWithCache (server/lib/strategy/tactical-planner.js)
// short-circuits the Places API call on catalog hit, falls through on miss,
// treats closed venues as misses, and applies district tie-breaking.
//
// Plan: docs/review-queue/PLAN_workstream6_step3_api_cache_enforcement-2026-05-03.md
// Locked decisions: §8 (rolled-up storage = strategies, exact-only lookup,
// closure-status freshness gate, wrapper-level district tie-break).

process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) {
  throw new Error('tests/strategy/tactical-planner-cache.test.js requires DATABASE_URL (real Postgres, no mocks per LESSONS_LEARNED.md)');
}
// Stub other secrets so module imports don't fail the env validator
if (!process.env.GOOGLE_MAPS_API_KEY) process.env.GOOGLE_MAPS_API_KEY = 'mock_key_step3_test';
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'mock_key_step3_test';
if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = 'mock_key_step3_test';
if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'mock_key_step3_test';

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { eq, like } from 'drizzle-orm';

import { db } from '../../server/db/drizzle.js';
import { venue_catalog } from '../../shared/schema.js';
import { normalizeVenueName } from '../../server/lib/venue/venue-utils.js';
import { resolveVenueWithCache } from '../../server/lib/strategy/tactical-planner.js';

const TEST_TAG = '__step3_cache_test__';
let insertedVenueIds = [];

async function seedVenue(fields = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const venue_name = fields.venue_name || `${TEST_TAG}_${suffix}`;
  // normalized_name MUST be computed via the real normalizeVenueName so seeds match
  // what lookupVenue's WHERE clause searches for. The function (venue-utils.js) does
  // lowercase + strip leading "The " + & → "and" + drop non-word chars + collapse
  // spaces. A homegrown test-side normalizer would diverge silently.
  const normalized_name = (fields.normalized_name ?? normalizeVenueName(venue_name));
  const lat = fields.lat ?? 33.123456;
  const lng = fields.lng ?? -96.123456;
  // coord_key is UNIQUE — randomize to avoid collisions across parallel test rows
  const coord_key = fields.coord_key || `${lat.toFixed(6)}_${lng.toFixed(6)}_${suffix}`;

  const [row] = await db.insert(venue_catalog).values({
    venue_name,
    normalized_name,
    address: '123 Test St',
    lat,
    lng,
    coord_key,
    city: fields.city || 'Frisco',
    state: fields.state || 'TX',
    category: fields.category || 'venue',
    record_status: fields.record_status || 'verified',
    last_known_status: fields.last_known_status || 'open',
    place_id: fields.place_id || null,
    district: fields.district || null,
    district_slug: fields.district_slug || null,
    formatted_address: fields.formatted_address || null,
  }).returning();

  insertedVenueIds.push(row.venue_id);
  return row;
}

async function cleanupTestRows() {
  for (const id of insertedVenueIds) {
    try {
      await db.delete(venue_catalog).where(eq(venue_catalog.venue_id, id));
    } catch (err) {
      // best effort — log to surface real cleanup failures
      console.error(`[test-cleanup] failed to delete venue ${id}: ${err.message}`);
    }
  }
  insertedVenueIds = [];
}

beforeEach(() => {
  insertedVenueIds = [];
});

afterEach(async () => {
  // Restore any global.fetch spies between tests so a hit-path test isn't blamed
  // for a miss-path test's leftover spy or vice versa.
  jest.restoreAllMocks();
  await cleanupTestRows();
});

afterAll(async () => {
  // Sweep any leftover test rows in case afterEach was skipped on a failure
  await db.delete(venue_catalog).where(like(venue_catalog.venue_name, `${TEST_TAG}%`));
});

describe('resolveVenueWithCache — cache hit path (no Places API call)', () => {
  test('5.1 — exact normalized name + city + state hit returns cached row, increments hits', async () => {
    const seeded = await seedVenue({ city: 'Frisco', state: 'TX' });
    const fetchSpy = jest.spyOn(global, 'fetch');
    const cacheMetrics = { hits: 0, misses: 0 };

    const result = await resolveVenueWithCache(
      { name: seeded.venue_name, district: null, category: 'venue' },
      { city: 'Frisco', state: 'TX', tz: 'America/Chicago', cacheMetrics }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheMetrics.hits).toBe(1);
    expect(cacheMetrics.misses).toBe(0);
    expect(result).not.toBeNull();
    expect(result.matchMethod).toBe('cache_hit');
    expect(result.google_lat).toBeCloseTo(seeded.lat, 6);
    expect(result.google_lng).toBeCloseTo(seeded.lng, 6);
    expect(result.similarity).toBe(1.0);

    fetchSpy.mockRestore();
  });

  test('5.4 — district tie-break: prefers row whose district_slug matches venue.district', async () => {
    const sharedName = `${TEST_TAG}_collision_${Math.random().toString(36).slice(2, 6)}`;
    // Use the real normalizer — both rows must end up with the SAME normalized_name
    // that lookupVenue will compute when querying with sharedName as input.
    const sharedNormalized = normalizeVenueName(sharedName);

    // Seed two rows with the SAME normalized_name + city + state but different districts.
    // The lookupVenue primitive returns one of them (LIMIT 1, undefined order); the
    // wrapper's tie-break should overwrite it with the matching-district row.
    const row_a = await seedVenue({
      venue_name: sharedName + ' (Legacy West)',
      normalized_name: sharedNormalized,
      district: 'Legacy West',
      district_slug: 'legacy-west',
      lat: 33.077,
      lng: -96.836,
    });
    const row_b = await seedVenue({
      venue_name: sharedName + ' (Deep Ellum)',
      normalized_name: sharedNormalized,
      district: 'Deep Ellum',
      district_slug: 'deep-ellum',
      lat: 32.785,
      lng: -96.781,
    });

    const fetchSpy = jest.spyOn(global, 'fetch');
    const cacheMetrics = { hits: 0, misses: 0 };

    const result = await resolveVenueWithCache(
      { name: sharedName, district: 'Deep Ellum', category: 'venue' },
      { city: 'Frisco', state: 'TX', tz: 'America/Chicago', cacheMetrics }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheMetrics.hits).toBe(1);
    // The tie-break must select the deep-ellum row, regardless of which one
    // lookupVenue's LIMIT 1 happened to return first.
    expect(result.google_lat).toBeCloseTo(row_b.lat, 6);
    expect(result.google_lng).toBeCloseTo(row_b.lng, 6);

    fetchSpy.mockRestore();
  });
});

describe('resolveVenueWithCache — cache miss path (falls through to Places API)', () => {
  test('5.2 — empty catalog → cacheMetrics.misses incremented and Places API attempted', async () => {
    // Mock fetch to return a "no places found" response — exercises the miss path
    // without making a real Places API call.
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
      text: async () => '',
    });
    const cacheMetrics = { hits: 0, misses: 0 };

    const uniqueName = `${TEST_TAG}_unseeded_${Math.random().toString(36).slice(2, 8)}`;
    const result = await resolveVenueWithCache(
      { name: uniqueName, district: null, category: 'venue' },
      { city: 'Frisco', state: 'TX', tz: 'America/Chicago', cacheMetrics }
    );

    expect(cacheMetrics.misses).toBe(1);
    expect(cacheMetrics.hits).toBe(0);
    expect(fetchSpy).toHaveBeenCalled();
    // First fetch call should hit the Places text search URL
    const firstCallUrl = fetchSpy.mock.calls[0][0];
    expect(firstCallUrl).toMatch(/places.googleapis\.com/);
    expect(result).toBeNull();  // Places returned no matches

    fetchSpy.mockRestore();
  });

  test('5.3 — closed venue in catalog forces re-validation through Places API', async () => {
    const seeded = await seedVenue({
      city: 'Frisco',
      state: 'TX',
      last_known_status: 'temporarily_closed',
    });

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
      text: async () => '',
    });
    const cacheMetrics = { hits: 0, misses: 0 };

    await resolveVenueWithCache(
      { name: seeded.venue_name, district: null, category: 'venue' },
      { city: 'Frisco', state: 'TX', tz: 'America/Chicago', cacheMetrics }
    );

    expect(cacheMetrics.misses).toBe(1);
    expect(cacheMetrics.hits).toBe(0);
    expect(fetchSpy).toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

// =============================================================================
// Integration cases (5.5–5.7) — DEFERRED FROM STEP 3
// =============================================================================
// The plan §5 listed three integration cases beyond the unit tests above:
//   5.5 — full generateTacticalPlan run with mixed hit/miss
//   5.6 — rolled-up counter persists to strategies row
//   5.7 — degraded path regression
// These require mocking VENUE_SCORER (LLM call), Google Routes API, and
// Google Places enrichment — substantial harness work that is its own
// follow-up. They are intentionally listed as test.skip below so coverage
// of the deferred surface is visible. Lift the skip when the integration
// harness lands.
describe('resolveVenueWithCache — integration cases (deferred)', () => {
  test.skip('5.5 — full generateTacticalPlan with mixed hit/miss (needs LLM/Routes mocks)', () => {});
  test.skip('5.6 — venue_cache_metrics persists to strategies row (needs full pipeline harness)', () => {});
  test.skip('5.7 — degraded path regression (needs LLM mock to force resolution failure)', () => {});
});
