// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 3/11).
// PILOT pipeline: validates the per-pipeline contract on the smallest, simplest pipeline
// before applying it to weather/airport/news/traffic/events.
//
// Owns: school_closures section of the briefings row + briefing_school_closures_ready
// pg_notify channel. Consumes optional cache hit from the orchestrator (the orchestrator
// is best-positioned to know whether prior briefings exist for the same city/day —
// that's snapshot-level orchestration knowledge — so it does the lookup and hands the
// result here).
//
// Logging tag: [BRIEFING][SCHOOLS] (per the 9-stage taxonomy enforcement principle —
// the file location IS the taxonomy declaration).

import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';
import { haversineDistanceMiles } from '../../location/geo.js';
import { safeJsonParse } from '../shared/safe-json-parse.js';
import { writeSectionAndNotify, CHANNELS } from '../briefing-notify.js';

/**
 * Get region-specific search terms for school authorities.
 * Handles US, UK, Canada, Australia, with US default.
 * @param {string} country - country code or name
 * @returns {{ authority: string, terms: string, type: string }}
 */
export function getSchoolSearchTerms(country) {
  const c = (country || 'US').toLowerCase();

  if (['united kingdom', 'uk', 'gb', 'england', 'scotland', 'wales'].includes(c)) {
    return { authority: 'Local Education Authority', terms: 'term dates, bank holidays, half-term', type: 'council' };
  }
  if (['canada', 'ca'].includes(c)) {
    return { authority: 'School Board', terms: 'school board calendar, PA days, professional development', type: 'board' };
  }
  if (['australia', 'au'].includes(c)) {
    return { authority: 'Department of Education', terms: 'school term dates, pupil-free days', type: 'state' };
  }
  // Default: US
  return { authority: 'School District/ISD', terms: 'school district calendar, student holidays, professional development', type: 'district' };
}

/**
 * Fetch school closures from Gemini for a snapshot's location.
 * Returns nearby (≤15mi) closures with normalized snake_case fields.
 *
 * This is the raw fetch — no SSE write, no cache decision. Callers that need
 * the full pipeline behavior (cache + write + notify) should use discoverSchools.
 *
 * @param {{ snapshot: object }} args
 * @returns {Promise<Array>} closures array (possibly empty)
 */
export async function fetchSchoolClosures({ snapshot }) {
  if (!process.env.GEMINI_API_KEY || !snapshot?.city || !snapshot?.state) return [];

  const { city, state, lat, lng, country } = snapshot;
  const context = getSchoolSearchTerms(country);

  const prompt = `Analyze academic schedules and closures for ${city}, ${state}${country !== 'US' ? `, ${country}` : ''} for the next 30 days.

TARGET COORDINATES: ${lat}, ${lng}
SEARCH RADIUS: 15 miles

TASK 1: K-12 PUBLIC SCHOOLS (${context.authority})
Search for: ${context.terms}
Look for local school districts/boards using regional naming conventions (e.g., "ISD" in Texas, "Parish Schools" in Louisiana, "School Board" in Canada).

TASK 2: UNIVERSITIES & COLLEGES
Search for major universities within 15 miles. Look for breaks, move-in/out days, commencement, finals week.

TASK 3: PRIVATE & RELIGIOUS SCHOOLS
Check for major private academies with different schedules than public schools.

IMPORTANT: Each institution type may have DIFFERENT calendars. Public schools can be closed while private schools are open (and vice versa).

Return ONLY a valid JSON array with institutions that are CLOSED or closing soon:
[
  {
    "schoolName": "Name of district or institution",
    "type": "public" | "private" | "college",
    "closureStart": "YYYY-MM-DD",
    "reopeningDate": "YYYY-MM-DD (MUST be the FIRST DAY students return to class, NOT the last day of closure. Example: if closed Mon Feb 16, reopeningDate is Tue Feb 17)",
    "reason": "Holiday Name / Break / Professional Development",
    "impact": "high" | "medium" | "low",
    "lat": 32.xxx,
    "lng": -96.xxx
  }
]

NOTES:
- Include approximate lat/lng coordinates for each institution (for distance calculation)
- "impact" should be "high" for large districts/universities, "medium" for mid-size, "low" for small private schools
- CRITICAL: "reopeningDate" = first day students are BACK in school (end of closure + 1 day). If Presidents' Day is Feb 16 (Monday), reopeningDate is Feb 17 (Tuesday).
- If no closures are found, return an empty array []`;

  const system = `You are a school calendar research assistant. Search for school closures, holidays, and academic schedules. Return structured JSON data.`;
  matrixLog.info({
    category: 'BRIEFING',
    connection: 'AI',
    action: 'DISPATCH',
    roleName: 'BRIEFER',
    secondaryCat: 'SCHOOLS',
    location: 'pipelines/schools.js:fetchSchoolClosures',
  }, 'Calling Briefer for school closures');
  const result = await callModel('BRIEFING_SCHOOLS', { system, user: prompt });

  if (!result.ok) {
    matrixLog.error({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'COMPLETE',
      roleName: 'BRIEFER',
      secondaryCat: 'SCHOOLS',
      location: 'pipelines/schools.js:fetchSchoolClosures',
    }, 'Briefer call failed', result.error);
    return [];
  }

  try {
    const closures = safeJsonParse(result.output);
    const closuresArray = Array.isArray(closures) ? closures : [];

    if (closuresArray.length === 0) {
      briefingLog.info(`No school closures found for ${city}, ${state}`);
      return [];
    }

    // 2026-04-16: FIX — Normalize Gemini's camelCase response to snake_case fields.
    // Downstream filters (consolidator.js, filter-for-planner.js) check
    // start_date/end_date/reopening_date (snake_case).
    const normalized = closuresArray.map((c) => ({
      ...c,
      start_date: c.start_date || c.closureStart || c.startDate || c.closure_date,
      end_date: c.end_date || c.reopeningDate || c.endDate || c.closureStart,
      reopening_date: c.reopening_date || c.reopeningDate,
      school_name: c.school_name || c.schoolName || c.name || c.district,
      closure_reason: c.closure_reason || c.reason,
    }));

    const enriched = normalized.map((c) => {
      let distanceFromDriver = null;
      if (c.lat && c.lng && lat && lng) {
        distanceFromDriver = parseFloat(haversineDistanceMiles(lat, lng, c.lat, c.lng).toFixed(1));
      }
      return { ...c, distanceFromDriver };
    });

    const nearbyClosures = enriched.filter((c) => {
      if (c.distanceFromDriver === null || c.distanceFromDriver === undefined) {
        briefingLog.warn(2, `School ${c.schoolName} has no coordinates - including anyway`, OP.AI);
        return true;
      }
      return c.distanceFromDriver <= 15;
    });

    const filteredOutCount = enriched.length - nearbyClosures.length;
    if (filteredOutCount > 0) {
      briefingLog.phase(2, `School closures: filtered ${filteredOutCount} beyond 15mi`, OP.AI);
    }

    if (nearbyClosures.length > 0) {
      briefingLog.done(2, `${nearbyClosures.length} school closures found for ${city}, ${state}`, OP.AI);
    }

    return nearbyClosures;
  } catch (parseErr) {
    briefingLog.warn(2, `School closures parse failed: ${parseErr.message}`, OP.AI);
    return [];
  }
}

/**
 * Pipeline contract: discover school closures for a snapshot.
 *
 * Resolves closures from cache (if provided by orchestrator) or fresh fetch,
 * writes the school_closures section to the briefings row, fires the
 * CHANNELS.SCHOOL_CLOSURES pg_notify, and returns the closures array for
 * the orchestrator's final atomic reconciliation write.
 *
 * The cache LOOKUP (querying other snapshots in the same city) belongs in
 * the orchestrator — it's cross-snapshot knowledge. The cache USAGE +
 * fresh-fetch fallback + SSE write are this pipeline's responsibility.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row
 * @param {string} args.snapshotId - snapshot UUID
 * @param {object|Array|null} [args.cachedClosures] - prior school_closures
 *   value from a same-day cache lookup; null/undefined = fetch fresh.
 * @returns {Promise<{ closures: Array, reason: string|null }>} closures
 *   array (possibly empty) plus reason string for the orchestrator's final
 *   atomic write. Reason is null when closures.length > 0.
 */
export async function discoverSchools({ snapshot, snapshotId, cachedClosures = null }) {
  let closures;
  let reason = 'No school closures found for this area';

  if (cachedClosures) {
    closures = cachedClosures.items || cachedClosures;
    reason = closures.length > 0 ? null : 'No school closures in cache for this area';
  } else {
    briefingLog.phase(2, `Fetching school closures`, OP.AI);
    try {
      closures = await fetchSchoolClosures({ snapshot });
      reason = closures.length > 0 ? null : 'No school closures found for this area';
    } catch (err) {
      // Non-fatal — closures failing shouldn't prevent other data from being stored
      console.error(`[BRIEFING] Closures fetch failed (non-fatal): ${err.message}`);
      closures = [];
      reason = `School closures fetch failed: ${err.message}`;
    }
  }

  // 2026-04-18: PHASE A — progressive write for school_closures as soon as we have
  // a value (whether from cache hit or fresh fetch). Lets the tab populate this
  // section before the final atomic write lands.
  await writeSectionAndNotify(snapshotId, {
    school_closures: closures.length > 0 ? closures : { items: [], reason },
  }, CHANNELS.SCHOOL_CLOSURES);

  return { closures, reason };
}
