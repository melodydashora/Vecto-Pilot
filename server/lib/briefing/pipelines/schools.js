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
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';
import { getLocalDateString, getLocalIso } from '../../../../shared/dayparts.js';
import { getSchoolClosureInterval, getSchoolClosureStatusOnDate } from '../../../../shared/school-closures.js';

// Validate every returned interval before removing valid records outside today.
// A malformed or incomplete record is a failed research result, not an empty day.
function normalizeClosuresForToday(closures, today, requireReopeningDate = false) {
  if (!Array.isArray(closures)) throw new Error('School closures response is not a JSON array');
  return closures.map((closure, index) => {
    const interval = getSchoolClosureInterval(closure);
    if (!interval || (requireReopeningDate && !interval.endExclusive)) {
      throw new Error(`School closures record ${index + 1} has invalid or missing calendar dates`);
    }
    return {
      ...closure,
      start_date: interval.startDate,
      end_date: interval.endDate,
      reopening_date: interval.endExclusive ? interval.endDate : undefined,
      status: getSchoolClosureStatusOnDate(closure, today),
      school_name: closure.school_name || closure.schoolName || closure.name || closure.district,
      closure_reason: closure.closure_reason || closure.reason,
    };
  }).filter(closure => closure.status !== null);
}

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
 * Returns today's nearby (≤15mi) breaks and student returns with derived status.
 *
 * This is the raw fetch — no SSE write, no cache decision. Callers that need
 * the full pipeline behavior (cache + write + notify) should use discoverSchools.
 *
 * @param {{ snapshot: object }} args
 * @returns {Promise<Array>} closures array (possibly empty)
 */
export async function fetchSchoolClosures({ snapshot }) {
  if (!process.env.GEMINI_API_KEY) throw new Error('School closures provider not configured');
  if (['city', 'state'].some(field => typeof snapshot?.[field] !== 'string' || !snapshot[field].trim())) {
    throw new Error('School closures snapshot requires city and state');
  }

  const { city, state, market, lat, lng, country, timezone } = snapshot;
  // Research the current driver-local day, as Events/News do. Snapshot created_at
  // is a saved capture instant; local_iso is wall-clock text, not a new UTC instant.
  const now = new Date();
  const today = getLocalDateString(now, timezone); // Required valid timezone; no UTC fallback.
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone }).format(now);
  const context = getSchoolSearchTerms(country);
  const hasMarket = typeof market === 'string' && market.trim().length > 0;

  // 2026-10-11: Melody's intent is today's travel context across connected towns,
  // including the full school-free break, rather than a 30-day closure forecast.
  const prompt = `Help a driver understand school breaks and student returns affecting today's travel across nearby towns and neighborhoods.

Today: ${today} (${weekday}), timezone ${timezone}.
Current local time: ${getLocalIso(now, timezone).slice(11)}.
City: ${city}, ${state}${country ? `, ${country}` : ''}.${hasMarket ? ` Market: ${market}.` : ''}

Check public ${context.authority} calendars, private schools, and colleges in this city and surrounding connected communities${hasMarket ? ' in this market' : ''}. District boundaries cross city lines: check each relevant district separately, including those named for a neighboring city.

Use current official calendars or notices for holidays, academic breaks, professional development days and unexpected closures. Each institution has its own student calendar.

Report the complete continuous school-free interval around a verified break, including adjoining weekends or verified non-class days. Never extend it across a scheduled student class day. closureStart is its first full non-class date; reopeningDate is the first date students actually return, even if staff return earlier. Explain the break and adjoining weekend in reason. A normal weekend alone is not a break.

Include an institution only when closureStart <= ${today} <= reopeningDate. When reopeningDate is today, include the completed break so the briefing can explain that students return today; the institution is no longer closed. Exclude future intervals and institutions whose students returned before today.

Return a JSON array, pretty-printed with two-space indentation, using all these fields:
[{"schoolName":"Institution name","type":"public|private|college","closureStart":"YYYY-MM-DD","reopeningDate":"YYYY-MM-DD","reason":"Break explanation","impact":"high|medium|low","lat":null,"lng":null}]
Coordinates are approximate institution/campus numbers when known; otherwise null. Impact describes size: high for large districts/universities, medium for mid-size, low for small schools. Keep descriptions inside JSON fields.

Return [] only after successful research finds no relevant break or student return today. If research fails or required calendar facts cannot be verified, return {"error":"school_calendar_verification_failed"}. Do not invent dates or turn failed research into an empty result.`;

  const system = 'Research school calendars to explain school breaks and student returns affecting today’s travel. Return the requested JSON using verified calendar facts.';
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
    throw new Error('School closures provider failed: ' + (result.error || 'unknown provider failure'));
  }

  try {
    const closures = safeJsonParse(result.output);
    // Fresh research must give the first student return date. Cached legacy
    // records may instead give a last-closed end_date (handled below).
    const normalized = normalizeClosuresForToday(closures, today, true);

    if (normalized.length === 0) {
      briefingLog.info(`No school closures found for ${city}, ${state}`);
      return [];
    }

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
    throw parseErr;
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

  try {
    if (cachedClosures) {
      // Section markers take precedence over any retained items. A partial or
      // failed cached section must never become successful calendar research.
      if (cachedClosures._generationFailed || cachedClosures._pending || cachedClosures.isFallback) {
        throw new Error('School closures cached research is incomplete or failed');
      }
      const today = getLocalDateString(new Date(), snapshot?.timezone);
      closures = normalizeClosuresForToday(cachedClosures.items || cachedClosures, today);
      reason = closures.length > 0 ? null : 'No school closures in cache for this area';
    } else {
      briefingLog.phase(2, `Fetching school closures`, OP.AI);
      closures = await fetchSchoolClosures({ snapshot });
      reason = closures.length > 0 ? null : 'No school closures found for this area';
    }
  } catch (err) {
    await writeSectionAndNotify(snapshotId, { school_closures: errorMarker(err) }, CHANNELS.SCHOOL_CLOSURES);
    throw err;
  }

  // 2026-04-18: PHASE A — progressive write for school_closures as soon as we have
  // a value (whether from cache hit or fresh fetch). Lets the tab populate this
  // section before the final atomic write lands.
  await writeSectionAndNotify(snapshotId, {
    school_closures: closures.length > 0 ? closures : { items: [], reason },
  }, CHANNELS.SCHOOL_CLOSURES);

  return { closures, reason };
}
