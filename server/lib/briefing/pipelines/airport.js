// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 5/11).
// Owns: airport_conditions section of the briefings row + briefing_airport_ready
// pg_notify channel.
//
// Live path: callModel('BRIEFING_AIRPORT') (Gemini with Google Search grounding).
// Includes a manual JSON-extraction fallback (extractAirportJson) used when
// safeJsonParse can't recover JSON from a markdown-wrapped Gemini response.
//
// Internal-only: fetchAirportConditions and extractAirportJson are NOT re-exported.
// The orchestrator (briefing-service.js) imports only `discoverAirport`.
//
// Logging tag: [BRIEFING][AIRPORT] (per the 9-stage taxonomy enforcement principle —
// the file location IS the taxonomy declaration).

import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';
import { safeJsonParse } from '../shared/safe-json-parse.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';

/**
 * 2026-04-05: Manual airport JSON extraction — last resort when safeJsonParse fails.
 * Gemini with google_search often wraps JSON in markdown narrative. This function
 * extracts airport data by walking braces and looking for the "airports" key.
 */
function extractAirportJson(rawText) {
  if (!rawText) return { airports: [] };

  // Strategy 1: Find {"airports" and extract the balanced object
  const airportsIdx = rawText.indexOf('"airports"');
  if (airportsIdx === -1) {
    console.warn('[BRIEFING] [AIRPORT] No "airports" key found in response');
    return { airports: [] };
  }

  // Walk backwards to find the opening brace
  let objStart = -1;
  for (let i = airportsIdx - 1; i >= 0; i--) {
    if (rawText[i] === '{') { objStart = i; break; }
  }
  if (objStart === -1) return { airports: [] };

  // Walk forward to find the balanced closing brace
  let depth = 0;
  for (let i = objStart; i < rawText.length; i++) {
    if (rawText[i] === '{') depth++;
    else if (rawText[i] === '}') {
      depth--;
      if (depth === 0) {
        const candidate = rawText.slice(objStart, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          // Strategy 2: Clean common issues and retry
          try {
            const cleaned = candidate
              .replace(/\*+/g, '')           // Strip markdown bold/italic
              .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')  // Strip markdown links
              .replace(/,\s*([}\]])/g, '$1');  // Strip trailing commas
            return JSON.parse(cleaned);
          } catch {
            console.warn('[BRIEFING] [AIRPORT] Manual extraction found object but parse failed');
          }
        }
        break;
      }
    }
  }

  return { airports: [] };
}

/**
 * Fetch airport conditions using Gemini with Google Search.
 * Includes flight delays, arrivals, departures, and airport recommendations for drivers.
 *
 * Contract: never throws on graceful path — internal try/catch returns a fallback
 * object with `reason`. The wrapping `discoverAirport` adds defensive errorMarker
 * handling for unexpected throws (e.g., import-time errors, sync failures).
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.snapshot - Snapshot with location data
 * @returns {Promise<Object>} Airport conditions data (object with `airports`, `busyPeriods`,
 *   `recommendations`; on no-data path also includes `reason` and `isFallback: true`)
 */
async function fetchAirportConditions({ snapshot }) {
  // Require valid location data - no fallbacks for global app
  if (!snapshot?.city || !snapshot?.state || !snapshot?.timezone) {
    briefingLog.warn(2, 'Missing location data in snapshot - cannot fetch airport conditions', OP.AI);
    return {
      airports: [],
      busyPeriods: [],
      recommendations: 'Airport data unavailable — snapshot missing city, state, or timezone',
      reason: 'Snapshot missing required location data (city/state/timezone)'
    };
  }
  const city = snapshot.city;
  const state = snapshot.state;
  const timezone = snapshot.timezone;

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // Fallback for API failures — NO NULLS: always include reason
  const fallbackAirport = {
    airports: [],
    busyPeriods: [],
    recommendations: `Airport data for ${city}, ${state} could not be retrieved`,
    fetchedAt: new Date().toISOString(),
    isFallback: true,
    reason: `Airport conditions provider (Gemini) failed for ${city}, ${state}`
  };

  // GEMINI 3 PRO PREVIEW (PRIMARY) - uses Google Search grounding
  if (!process.env.GEMINI_API_KEY) {
    briefingLog.warn(2, `GEMINI_API_KEY not set - skipping airport search`, OP.AI);
    return fallbackAirport;
  }

  try {
    matrixLog.info({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'DISPATCH',
      roleName: 'BRIEFER',
      secondaryCat: 'AIRPORT',
      location: 'pipelines/airport.js:fetchAirportConditions',
    }, 'Calling Briefer for airport conditions');

    const system = `You are an airport conditions API. Return ONLY valid JSON. No prose, no markdown, no explanatory text, no code fences. Output a single JSON object and nothing else.`;
    const user = `Search for current airport conditions near ${city}, ${state} as of ${date}.

Find airports within 50 miles. Return ONLY this JSON structure (no other text):
{"airports":[{"code":"IATA","name":"Airport Name","delays":"description","status":"normal","busyTimes":["time range"]}],"busyPeriods":["description"],"recommendations":"driver tips"}`;

    const result = await callModel('BRIEFING_AIRPORT', { system, user });

    if (!result.ok) {
      matrixLog.error({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'COMPLETE',
        roleName: 'BRIEFER',
        secondaryCat: 'AIRPORT',
        location: 'pipelines/airport.js:fetchAirportConditions',
      }, 'Briefer call failed', result.error);
      return fallbackAirport;
    }

    // 2026-04-05: Try safeJsonParse first, fall back to manual extraction if it fails.
    // Gemini with google_search often wraps JSON in markdown narrative text.
    let parsed;
    try {
      parsed = safeJsonParse(result.output);
    } catch (parseErr) {
      // Manual extraction: find {"airports" or [{"code" in the raw text
      console.warn(`[BRIEFING] [AIRPORT] safeJsonParse failed (${parseErr.message}), trying manual extraction...`);
      console.log(`[BRIEFING] [AIRPORT] Raw (first 300):`, result.output?.substring(0, 300));
      parsed = extractAirportJson(result.output);
    }
    briefingLog.done(2, `Gemini airport: ${parsed.airports?.length || 0} airports`, OP.AI);

    return {
      airports: Array.isArray(parsed.airports) ? parsed.airports : [],
      busyPeriods: Array.isArray(parsed.busyPeriods) ? parsed.busyPeriods : [],
      recommendations: parsed.recommendations || 'No specific airport recommendations at this time',
      fetchedAt: new Date().toISOString(),
      provider: 'gemini'
    };
  } catch (err) {
    briefingLog.warn(2, `Gemini airport error: ${err.message}`, OP.FALLBACK);
    return fallbackAirport;
  }
}

/**
 * Pipeline contract: discover airport conditions for a snapshot.
 *
 * Calls Gemini (via fetchAirportConditions), writes airport_conditions section to
 * the briefings row, fires CHANNELS.AIRPORT pg_notify, returns
 * { airport_conditions, reason }.
 *
 * fetchAirportConditions's internal try/catch handles AI provider failures and
 * returns a fallback object — so the catch block here is defensive (handles
 * unexpected sync/import errors). The defense-in-depth `||` short-circuit
 * preserves exact parity with the orchestrator's prior `r || {fallback}` SSE
 * write fallback.
 *
 * @param {object} args
 * @param {object} args.snapshot - snapshot row (city/state/timezone required)
 * @param {string} args.snapshotId - snapshot UUID
 * @returns {Promise<{ airport_conditions: object, reason: string|null }>}
 */
export async function discoverAirport({ snapshot, snapshotId }) {
  let airport_conditions;
  let reason = null;

  try {
    airport_conditions = await fetchAirportConditions({ snapshot }) || {
      airports: [],
      busyPeriods: [],
      recommendations: 'No airport data available for this area',
      reason: 'Airport conditions could not be retrieved'
    };
    reason = airport_conditions?.reason || null;
    await writeSectionAndNotify(snapshotId, { airport_conditions }, CHANNELS.AIRPORT);
  } catch (err) {
    airport_conditions = errorMarker(err);
    reason = err.message;
    await writeSectionAndNotify(snapshotId, { airport_conditions }, CHANNELS.AIRPORT);
    throw err;
  }

  return { airport_conditions, reason };
}
