// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 5/11).
// Owns: airport_conditions section of the briefings row + briefing_airport_ready
// pg_notify channel.
//
// 2026-07-06 (todo #22, Melody): REBUILT around deterministic selection.
//   - WHICH airports: findNearbyAirports (airports table, Google-seeded
//     coords, AIRPORT_RADIUS_MILES=50) — the model NEVER discovers airports
//     (the old "find airports within 50 miles of {city}" prompt returned a
//     different set every run: the 1-vs-3 nondeterminism).
//   - Conditions come from FAA when usable, otherwise BRIEFING_AIRPORT searches
//     for those missing conditions. A separate BRIEFING_AIRPORT terminal pass
//     consumes that fixed result — it does not research flight conditions again.
//     Terminal inventory controls checkpoint/Clear structure and pickup guidance.
//   - best_entry per lane type is COMPUTED server-side from returned waits
//     (min across checkpoints) — never chosen by the model. Melody: "knowing
//     the best entry point is one of the best pieces of information to give
//     for airports."
//   - FAA NAS observations retain their own fields and source timestamps.
//   - Model-agnostic: role-addressed, no vendor names, no vendor env gates.
//
// Internal-only: fetchAirportConditions and extractAirportJson are NOT re-exported.
// The orchestrator imports only `discoverAirport`.
//
// Logging tag: [BRIEFING][AIRPORT]

import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';
import { safeJsonParse } from '../shared/safe-json-parse.js';
import { writeSectionAndNotify, CHANNELS, errorMarker } from '../briefing-notify.js';
import { findNearbyAirports, AIRPORT_RADIUS_MILES } from '../../location/airports.js';
import { fetchFAADelayData } from '../../external/faa-asws.js';

/**
 * 2026-04-05: Manual airport JSON extraction — last resort when safeJsonParse fails.
 * Search-grounded models often wrap JSON in markdown narrative. This function
 * extracts airport data by walking braces and looking for the "airports" key.
 *
 * 2026-05-12 (D-110): The brace walker is now string-aware — it tracks whether we're
 * inside a quoted string value and ignores braces inside strings. The previous version
 * counted any `{`/`}` regardless of context, so a `{` inside a JSON string value (e.g.,
 * inside the recommendations field) would desync the depth counter and cause the walker
 * to either overshoot or undershoot the matching close brace. Same state-machine pattern
 * as safe-json-parse.js's D-109 fix.
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

  // Walk forward to find the balanced closing brace — string-aware so braces inside
  // string values don't desync the depth counter.
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = objStart; i < rawText.length; i++) {
    const c = rawText[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (c === '\\') {
      escapeNext = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;  // braces inside string values are not structural

    if (c === '{') depth++;
    else if (c === '}') {
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
 * Fetch airport conditions: deterministic airport selection + BRIEFING_AIRPORT
 * role research of the named airports (model-agnostic, role-addressed).
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
/**
 * Compute the best entry point per lane type from returned checkpoint waits.
 * Deterministic server-side computation — the model reports waits, it never
 * picks winners. Returns { general?, preCheck?, clear? } where each value is
 * { terminal, checkpoint, waitMinutes } for the minimum numeric wait found.
 */
function computeBestEntry(terminals) {
  const best = {};
  for (const t of terminals || []) {
    for (const cp of t.checkpoints || []) {
      for (const [lane, wait] of Object.entries(cp.lanes || {})) {
        const minutes = typeof wait === 'number' ? wait : parseInt(wait, 10);
        if (!Number.isFinite(minutes)) continue; // 'unreported' — never a candidate
        if (!best[lane] || minutes < best[lane].waitMinutes) {
          best[lane] = { terminal: t.terminal, checkpoint: cp.name || null, waitMinutes: minutes };
        }
      }
    }
  }
  return best;
}

function conditionsFromFAA(code, faa) {
  if (!faa) return null;
  const status = faa.ground_stops?.length || faa.closure_status === 'ground-stop' ? 'ground-stop'
    : faa.closure_status === 'closed' ? 'closed'
    : faa.closure_status === 'restricted' ? 'restricted'
    : faa.has_delays === true || (Number.isFinite(faa.delay_minutes) && faa.delay_minutes > 0) ? 'delayed'
    : faa.has_delays === false ? 'normal' : null;
  if (!status) return null;
  return { code, status, delays: faa.delay_reason || (status === 'normal'
    ? 'FAA explicitly reports no delays.' : `FAA reports ${status} conditions.`), conditionsSource: 'faa' };
}

async function fetchAirportConditions({ snapshot }) {
  // Require GPS coords + timezone — selection is coords-based (no fallbacks)
  if (!Number.isFinite(snapshot?.lat) || !Number.isFinite(snapshot?.lng) || !snapshot?.timezone) {
    briefingLog.warn(2, 'Snapshot missing lat/lng/timezone - cannot select airports', OP.AI);
    return {
      airports: [],
      busyPeriods: [],
      recommendations: 'Airport data unavailable — snapshot missing coordinates or timezone',
      reason: 'Snapshot missing required lat/lng/timezone for airport selection'
    };
  }
  const timezone = snapshot.timezone;

  // Get current date in user's timezone
  let date;
  if (snapshot?.local_iso) {
    date = new Date(snapshot.local_iso).toISOString().split('T')[0];
  } else {
    date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }

  // STEP 1 — deterministic selection: which airports (never the model's call)
  const nearby = await findNearbyAirports(snapshot.lat, snapshot.lng);

  if (nearby.length === 0) {
    // The seeded catalog has no coverage receipt for this radius. An empty
    // lookup cannot prove the geographic absence of airports.
    return {
      airports: [],
      busyPeriods: [],
      recommendations: 'Nearby airport coverage could not be verified.',
      reason: `The airport catalog returned no matches in the ${AIRPORT_RADIUS_MILES}-mile radius; geographic coverage is unknown.`,
      verifiedEmpty: false,
      coverage: 'unknown',
      isFallback: true,
      fetchedAt: new Date().toISOString()
    };
  }

  const airportList = nearby.map((a) => `${a.iata} (${a.name}, ${a.distance_miles} mi away)`).join('; ');
  const faaByCode = {};
  const conditionsByCode = new Map();
  const faaFields = code => {
    const faa = faaByCode[code];
    return faa ? {
      faa_delay_minutes: faa.delay_minutes,
      faa_has_delays: faa.has_delays,
      ...(Array.isArray(faa.ground_stops) ? { faa_ground_stops: faa.ground_stops } : {}),
      faa_delay_reason: faa.delay_reason ?? null,
      faa_closure_status: faa.closure_status,
      faa_closure_start: faa.closure_start ?? null,
      faa_closure_end: faa.closure_end ?? null,
      faa_supported: faa.supported,
      faa_source_updated_at: faa.source_updated_at,
      faa_fetched_at: faa.fetched_at,
    } : {};
  };

  // Failure object for the research call — reason recorded, role-addressed,
  // and the deterministic airport list is preserved so the UI can still show
  // WHICH airports exist even when live conditions are unavailable.
  const failureResult = (why) => ({
    airports: nearby.map((a) => ({
      code: a.iata,
      name: a.name,
      distance_miles: a.distance_miles,
      status: 'unknown',
      delays: 'Live conditions unavailable',
      ...conditionsByCode.get(a.iata),
      ...faaFields(a.iata),
    })),
    busyPeriods: [],
    recommendations: `Live airport conditions could not be researched — airports within ${AIRPORT_RADIUS_MILES} mi: ${nearby.map((a) => a.iata).join(', ')}`,
    fetchedAt: new Date().toISOString(),
    isFallback: true,
    reason: why
  });

  // One conditions source per airport: FAA first, research only for missing
  // usable observations. Concurrent lookups share one national feed request.
  // Terminal research starts after conditions resolve and cannot replace them.
  const faaEnrichment = Promise.all(
    nearby
      .filter((a) => a.country === 'US')
      .map(async (a) => {
        try {
          const faa = await fetchFAADelayData(a.iata, { strict: true });
          if (!faa) throw new Error(`FAA returned no status for ${a.iata}`);
          faaByCode[a.iata] = faa;
        } catch {
          briefingLog.warn(2, `FAA unavailable for ${a.iata}; conditions research will handle the missing source`, OP.FALLBACK);
          faaByCode[a.iata] = {
            delay_minutes: null,
            has_delays: null,
            closure_status: 'unknown',
            supported: null,
            delay_reason: 'FAA live status unavailable; see the separate airport conditions source.',
            source_updated_at: null,
            fetched_at: null,
          };
        }
      })
  );

  try {
    await faaEnrichment;
    for (const airport of nearby) {
      const conditions = conditionsFromFAA(airport.iata, faaByCode[airport.iata]);
      if (conditions) conditionsByCode.set(airport.iata, conditions);
    }
    const missingConditions = nearby.filter(airport => !conditionsByCode.has(airport.iata));
    if (missingConditions.length) {
      briefingLog.info(`Airport conditions fallback: ${missingConditions.map(airport => airport.iata).join(', ')}`);
      const conditionsResult = await callModel('BRIEFING_AIRPORT', {
        system: `Research current airport operating conditions using Google Search. Use current FAA advisories and official airport sources. Research ONLY the supplied airports. Use the driver's timezone ${timezone} for clock times. Return only JSON. Missing or stale evidence stays unreported; a failed FAA request does not mean normal operations. Do not research terminal checkpoints, pickup locations or TSA waits in this step.`,
        user: `Airport conditions fallback as of ${date}. Direct FAA data did not supply usable conditions for: ${missingConditions.map(airport => `${airport.iata} (${airport.name})`).join('; ')}.
Find current delays, ground stops, closures, diversions and operating restrictions for exactly these airports. Use normal only when current evidence explicitly confirms it. A scoped restriction is not a whole-airport closure. Do not invent minutes, conditions or FAA observations.
Return {"airports":[{"code":"<requested IATA>","status":"<normal|delayed|severe|closed|ground-stop|restricted|unreported>","delays":"<current source advisory, or unreported>"}]}. Include every requested airport even when its conditions are unreported.`,
      });
      if (!conditionsResult.ok) return failureResult(`Airport conditions fallback failed: ${conditionsResult.error}`);
      const conditions = safeJsonParse(conditionsResult.output);
      const allowedStatuses = new Set(['normal', 'delayed', 'severe', 'closed', 'ground-stop', 'restricted', 'unreported']);
      if (!Array.isArray(conditions?.airports) || conditions.airports.length !== missingConditions.length) {
        return failureResult('Airport conditions fallback returned an incomplete airport list');
      }
      const requested = new Set(missingConditions.map(airport => airport.iata));
      for (const report of conditions.airports) {
        if (!report || !requested.delete(report.code) || !allowedStatuses.has(report.status)
          || typeof report.delays !== 'string' || !report.delays.trim()) {
          return failureResult('Airport conditions fallback returned invalid or mismatched conditions');
        }
        conditionsByCode.set(report.code, { code: report.code, status: report.status,
          delays: report.delays, conditionsSource: 'gemini-search' });
      }
    }

    matrixLog.info({
      category: 'BRIEFING',
      connection: 'AI',
      action: 'DISPATCH',
      roleName: 'BRIEFER',
      secondaryCat: 'AIRPORT',
      location: 'pipelines/airport.js:fetchAirportConditions',
    }, `Researching terminals for ${nearby.length} named airports using resolved conditions: ${nearby.map((a) => a.iata).join(', ')}`);

    // STEP 3 — the model researches the NAMED airports only. Terminal
    // inventory (where seeded) tells it the terminal list, checkpoint count
    // expectation, and where Clear exists — so it fills a known structure
    // instead of inventing one (the old single-tsa-per-airport schema could
    // not even represent "2 checkpoints per terminal, Clear at E").
    const inventoryLines = nearby
      .filter((a) => Array.isArray(a.terminals) && a.terminals.length > 0)
      .map((a) =>
        `${a.iata} terminals: ${a.terminals
          .map((t) => `${t.terminal}${t.clear_available ? ' (has Clear)' : ''} (~${t.checkpoints_estimate || 2} checkpoints)`)
          .join(', ')}`
      )
      .join('\n');

    const system = `You are a terminal research assistant for rideshare drivers. Airport operating conditions have already been resolved and are fixed input. Do not re-fetch, re-research, correct or replace flight delays, ground stops, closures or diversions. Use web search ONLY for terminal checkpoint waits, arrivals schedules/activity, rideshare pickup locations and typical terminal demand windows. Keep advice consistent with the supplied conditions; unknown conditions stay unknown. Research ONLY the listed airports. Express EVERY clock time in the driver's local timezone (${timezone}). Return ONLY valid JSON, without prose, markdown or code fences.`;
    const user = `Research terminal details as of ${date} for exactly these airports: ${airportList}. All times in ${timezone} local time.
FIXED AIRPORT CONDITIONS (read-only context; do not research these again or return replacement status/delays):
${JSON.stringify(nearby.map(airport => ({ ...conditionsByCode.get(airport.iata), faa: faaByCode[airport.iata] ?? null })))}
${inventoryLines ? `\nKnown terminal structure — your terminals array for these airports MUST contain one entry per terminal listed here (fill what search finds; use "unreported" for what it doesn't; Clear lanes exist ONLY where marked):\n${inventoryLines}\n` : ''}
For EACH airport, search for:
1. PER-TERMINAL TSA CHECKPOINT WAITS — report each available checkpoint by name with general/PreCheck/Clear waits in minutes. Use "unreported" when unavailable; never fabricate.
2. PER-TERMINAL ARRIVALS ACTIVITY (which terminals have arrival banks now / next hour)
3. PER-TERMINAL RIDESHARE PICKUP locations
4. TYPICAL BUSY WINDOWS for rideshare pickup demand, qualified by the supplied operating conditions

Return ONLY this JSON structure (placeholders in <angle brackets> are value types, not literal text):
{"airports":[{"code":"<IATA from the given list>","busyTimes":["<HH:MM-HH:MM>"],"terminals":[{"terminal":"<terminal name>","arrivalsActivity":"<current arrivals info OR 'unreported'>","ridesharePickup":"<pickup location OR 'unreported'>","checkpoints":[{"name":"<checkpoint name OR 'unreported'>","lanes":{"general":<minutes OR "unreported">,"preCheck":<minutes OR "unreported">,"clear":<minutes OR "unreported">}}]}]}],"busyPeriods":["<HH:MM-HH:MM driver demand windows>"],"recommendations":"<2-3 sentences of terminal/pickup advice consistent with fixed conditions>"}`;

    const result = await callModel('BRIEFING_AIRPORT', { system, user });

    if (!result.ok) {
      matrixLog.error({
        category: 'BRIEFING',
        connection: 'AI',
        action: 'COMPLETE',
        roleName: 'BRIEFER',
        secondaryCat: 'AIRPORT',
        location: 'pipelines/airport.js:fetchAirportConditions',
      }, 'BRIEFING_AIRPORT role call failed', result.error);
      return failureResult(`BRIEFING_AIRPORT role call failed: ${result.error}`);
    }

    // Parse: safeJsonParse first, manual brace-walk extraction as recovery
    // (search-grounded models often wrap JSON in narrative markdown).
    let parsed;
    try {
      parsed = safeJsonParse(result.output);
    } catch (parseErr) {
      console.warn(`[BRIEFING] [AIRPORT] safeJsonParse failed (${parseErr.message}), trying manual extraction...`);
      console.log(`[BRIEFING] [AIRPORT] Raw (first 300):`, result.output?.substring(0, 300));
      parsed = extractAirportJson(result.output);
    }

    // A response that yields ZERO airports is a parse/truncation failure, not
    // data — the prompt requires an entry per named airport. Record it as a
    // failure with reason (todo #24 renders it honestly) instead of emitting
    // every airport as 'unreported', which would read like researched fact.
    if (!Array.isArray(parsed.airports) || parsed.airports.length === 0) {
      return failureResult('model response unparseable or truncated (no airports extracted)');
    }

    // STEP 4 — deterministic post-processing:
    //  - keep ONLY airports from the deterministic set (keyed by IATA);
    //    identity (name/distance) comes from the airports table, not the model
    //  - merge FAA delay data per US airport
    //  - compute best_entry per lane type from returned checkpoint waits
    const byCode = new Map((parsed.airports || []).map((a) => [a.code, a]));
    const missing = nearby.filter(a => !byCode.has(a.iata));
    if (missing.length) {
      return failureResult(`BRIEFING_AIRPORT omitted requested airports: ${missing.map(a => a.iata).join(', ')}`);
    }
    const airportsOut = nearby.map((known) => {
      const researched = byCode.get(known.iata) || {};
      let terminals = Array.isArray(researched.terminals) ? researched.terminals : [];

      // Enforce the seeded inventory DETERMINISTICALLY, two ways:
      //   1. SCAFFOLD: every seeded terminal ALWAYS appears in the output —
      //      the model's research is merged ONTO the inventory, so the card
      //      shows DFW A–E every run regardless of model variance (Melody's
      //      before/after screenshots: one run returned terminals, the next
      //      returned none — structure must never be the model's whim).
      //   2. CLEAR STRIPPING: where the inventory says a terminal has no
      //      Clear lane, drop any Clear wait the model reported there (live
      //      test: the model returned a Clear wait at DAL, which has none).
      if (Array.isArray(known.terminals) && known.terminals.length > 0) {
        const researchedByName = new Map(terminals.map((t) => [String(t.terminal).toLowerCase(), t]));
        const scaffolded = known.terminals.map((inv) => {
          const invName = String(inv.terminal).toLowerCase();
          // Match "E" against "E", "Terminal E", etc.
          const match = researchedByName.get(invName)
            || terminals.find((t) => {
              const rt = String(t.terminal).toLowerCase();
              return rt.endsWith(` ${invName}`) || invName.endsWith(` ${rt}`) || rt === `terminal ${invName}`;
            });
          const base = match || { terminal: inv.terminal, arrivalsActivity: 'unreported', ridesharePickup: 'unreported', checkpoints: [] };
          if (inv.clear_available !== false) return { ...base, terminal: inv.terminal };
          return {
            ...base,
            terminal: inv.terminal,
            checkpoints: (base.checkpoints || []).map((cp) => {
              if (!cp.lanes || cp.lanes.clear === undefined) return cp;
              const { clear: _clear, ...lanes } = cp.lanes;
              return { ...cp, lanes };
            }),
          };
        });
        // Keep any researched terminals the inventory doesn't know about
        const scaffoldNames = new Set(scaffolded.map((t) => String(t.terminal).toLowerCase()));
        const extras = terminals.filter((t) => {
          const rt = String(t.terminal).toLowerCase();
          return !scaffoldNames.has(rt) && !known.terminals.some((inv) => {
            const invName = String(inv.terminal).toLowerCase();
            return rt.endsWith(` ${invName}`) || rt === `terminal ${invName}`;
          });
        });
        terminals = [...scaffolded, ...extras];
      }
      return {
        code: known.iata,
        name: known.name,
        distance_miles: known.distance_miles,
        status: conditionsByCode.get(known.iata).status,
        delays: conditionsByCode.get(known.iata).delays,
        conditionsSource: conditionsByCode.get(known.iata).conditionsSource,
        busyTimes: Array.isArray(researched.busyTimes) ? researched.busyTimes : [],
        terminals,
        best_entry: computeBestEntry(terminals),
        ...faaFields(known.iata),
      };
    });

    briefingLog.done(2, `Airport research: ${airportsOut.length} named airports (${airportsOut.map((a) => a.code).join(', ')})`, OP.AI);

    return {
      airports: airportsOut,
      busyPeriods: Array.isArray(parsed.busyPeriods) ? parsed.busyPeriods : [],
      recommendations: parsed.recommendations || 'No specific airport recommendations at this time',
      fetchedAt: new Date().toISOString(),
      radiusMiles: AIRPORT_RADIUS_MILES,
      role: 'BRIEFING_AIRPORT'
    };
  } catch (err) {
    briefingLog.warn(2, `Airport research error: ${err.message}`, OP.FALLBACK);
    return failureResult(`airport research error: ${err.message}`);
  }
}

/**
 * Pipeline contract: discover airport conditions for a snapshot.
 *
 * Calls the BRIEFING_AIRPORT role (via fetchAirportConditions), writes airport_conditions section to
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
