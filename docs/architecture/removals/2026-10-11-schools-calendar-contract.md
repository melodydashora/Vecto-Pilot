# Schools calendar contract removal record

Date: October 11, 2026  
Updated: October 12, 2026 (UTC), after Melody accepted return-day visibility and the tested token-cap increase  
Status: verified local draft, including return-day behavior; not deployed  
Source baseline: `380bdb619dfdea77be9b357f02e3ef62bc5a8e43`

Melody requested school breaks affecting today's travel across the current city and surrounding connected communities. The former prompt requested the next 30 days, while consumers disagreed about which calendar days counted. The card used the browser day and included the first day students returned; server filters also treated explicit reopening dates as closed days.

The replacement contract uses the current date in the snapshot's timezone, not the saved capture date or the browser's timezone. A verified break includes adjoining weekends and non-class days up to the first student return date, without crossing a scheduled class day. A normal weekend alone does not establish a break. Explicit reopening dates are exclusive for the closed interval; legacy end dates remain inclusive only when no reopening date is supplied. The shared helper validates real, complete YYYY-MM-DD intervals, and fresh research must provide a student reopening date.

Melody first clarified that closure dates are the primary Briefing information, then requested retaining the first student return day as useful travel context. The accepted shared contract is `getSchoolClosureStatusOnDate(closure, today)`: `closed` during the closed interval, `reopening_today` on an explicit student return date, and `null` otherwise. A return day is never labeled closed. Future breaks and dates after the return day are outside today's result. A legacy last-closed date cannot imply a reopening status.

While a break is active, the card leads with the inclusive **Closed** range and shows **Students return** as secondary context only when an explicit return date exists. On that return day, **Students return today** becomes the primary information and the closed period is historical; the item drops the following day. The last closed date is the calendar day before an explicit return, computed in UTC; an inclusive legacy end date is displayed directly without inventing a return date. Stored dates retain their meaning rather than being extended to represent display retention.

Completed Briefings stop polling, so the card refreshes its display clock once a minute and when the window gains focus or the document becomes visible. It recalculates status from the saved dates in the snapshot's timezone, even when its parent remains unchanged overnight. This refresh makes no API or model call and does not claim to research newly announced calendar changes.

Fresh and cached pipeline results are validated before selecting today's closed or explicitly returning institutions. Provider failures, malformed records, and missing timezone retain failure behavior. The card reports missing or invalid calendar context as unavailable, distinguishes pending and verified-empty data, and formats date-only labels without shifting them into the browser timezone. Strategy and planner consumers use the shared status rule and distinguish returning students from an active closure.

Melody also authorized raising only `BRIEFING_SCHOOLS.maxTokens` from 8,192 to 16,384 after an isolated live comparison. The saved 8,192-cap receipt ended with `MAX_TOKENS` and the adapter's `truncated` error after 103.646 seconds. The 16,384-cap receipt completed with `STOP` after 92.306 seconds and returned eight records; reported usage included 12,171 thinking tokens and 1,311 candidate tokens. The higher cap provides room for HIGH thinking and the structured answer. These individual calls establish output-budget headroom, not a guaranteed latency or exhaustive calendar accuracy. Both had search enabled but no grounding metadata, so search enablement alone does not prove source verification. The role's model pin, HIGH thinking and 120-second timeout remain unchanged.

The existing server distance filter and deployment state remain unchanged. The prompt's broader neighboring-community wording does not remove that distance filter. The initial calendar implementation passed focused checks covering the shared helper, pipeline and planner boundaries, strategy filtering, and the actual Briefing provider-to-card path: 24 server tests and 19 client tests, including a Los Angeles browser timezone. Those earlier counts predate the return-day extension and are retained as historical evidence, not verification of the later changes. This record makes no claim of exhaustive live school-calendar coverage.

Local test evidence: `.config/astra-vecto-coordination/gemini-parameters-20261011/briefing-probe/schools-frisco-high-source-live-2026-10-12T00-21-22-093Z.json` and `schools-frisco-high-cap-live-2026-10-12T00-27-05-931Z.json`. The isolated cap comparison blocked real database access and left application source unchanged; it preceded the authorized source update.

Final verification on October 12: the cache review finding was corrected by rejecting `_generationFailed`, `_pending`, and `isFallback` before unwrapping cached items, including empty and retained-item envelopes. The coordinating agent reported 316 unique passing focused checks: 124 Schools/adapter checks (including 36 Schools checks), 69 Briefing dependency/provider-failure checks, 49 downstream checks, 50 Coach checks, and 24 client checks. Typecheck, client build, and scoped lint passed; the build retained its existing bundle-size warning. These checks cover return-day behavior offline and the display-clock refresh. They do not establish that a gateway restart or deployment has completed.

A separate current-source live probe used the saved `gemini-3.8-flash` role, HIGH thinking, the 16,384-token cap and 120-second deadline, with no configuration override or prompt replay. One provider call completed HTTP 200 / `STOP` in 106.394 seconds: 11 raw records became nine retained records after the unchanged distance filter removed Dallas and Denton. All retained records were closed on the test date; this call did not exercise a live return-day case. It made zero application database attempts and returned no grounding metadata. Receipt: `.config/astra-vecto-coordination/gemini-parameters-20261011/briefing-probe/schools-frisco-current-source-live-2026-10-12T00-39-13-014Z.json`.

## Preserved source

The excerpts below were read directly with `git show` from the baseline commit. They retain the superseded prompt, filters, comments, and rendering logic verbatim, with surrounding code for context. Some surrounding lines remain in the working source. These are historical evidence, not current instructions.

### Schools research and cache handling

Source: `server/lib/briefing/pipelines/schools.js`

```js
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
  if (!process.env.GEMINI_API_KEY) throw new Error('School closures provider not configured');
  if (!snapshot?.city || !snapshot?.state) throw new Error('School closures snapshot missing location');

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
    throw new Error('School closures provider failed: ' + (result.error || 'unknown provider failure'));
  }

  try {
    const closures = safeJsonParse(result.output);
    if (!Array.isArray(closures)) throw new Error('School closures response is not a JSON array');
    const closuresArray = closures;

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

  if (cachedClosures) {
    closures = cachedClosures.items || cachedClosures;
    reason = closures.length > 0 ? null : 'No school closures in cache for this area';
  } else {
    briefingLog.phase(2, `Fetching school closures`, OP.AI);
    try {
      closures = await fetchSchoolClosures({ snapshot });
      reason = closures.length > 0 ? null : 'No school closures found for this area';
    } catch (err) {
      await writeSectionAndNotify(snapshotId, { school_closures: errorMarker(err) }, CHANNELS.SCHOOL_CLOSURES);
      throw err;
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
```

### Planner clock and closure filter

Source: `server/lib/briefing/filter-for-planner.js`

```js
/**
 * Get today's date in the snapshot's timezone (YYYY-MM-DD format)
 *
 * @param {string} timezone - IANA timezone string
 * @returns {string} Date in YYYY-MM-DD format
 */
function getLocalDate(timezone) {
  if (!timezone) {
    // Fallback to UTC if no timezone - should not happen in production
    return new Date().toISOString().split('T')[0];
  }
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/**
 * Filter school closures to only those active today
 * Reuses logic from consolidator.js filterClosuresActiveToday
 *
 * @param {Array} closures - Array of closure objects
 * @param {string} today - Today's date in YYYY-MM-DD format
 * @returns {Array} Closures active today
 */
function filterClosuresToToday(closures, today) {
  if (!closures || !Array.isArray(closures) || closures.length === 0) {
    return [];
  }

  return closures.filter(c => {
    // 2026-04-16: Support both snake_case (normalized) and camelCase (legacy DB rows).
    // New data is normalized at ingestion in fetchSchoolClosures(); this covers older rows.
    const startDate = c.start_date || c.closureStart || c.startDate || c.closure_date || c.date;
    const endDate = c.end_date || c.reopeningDate || c.endDate || c.reopening_date || startDate;

    if (!startDate) return false;

    // Check: TODAY >= start_date AND TODAY <= end_date (inclusive)
    return today >= startDate && today <= endDate;
  });
}
```

### Strategy closure filter and summary

Source: `server/lib/ai/providers/consolidator.js`

```js
/**
 * Format school closures for strategist summary
 * Shows count, type breakdown, distance from driver, and reopening dates
 * Limits to 8 entries to save tokens in the prompt
 */
/**
 * 2026-01-08: FIX - Filter school closures where TODAY falls between start_date and end_date
 * Uses snapshot.timezone directly - no re-fetching
 * @param {Array} closures - Array of closure objects with start_date/end_date
 * @param {string} timezone - IANA timezone from snapshot (required)
 * @returns {Array} Closures active TODAY only
 */
function filterClosuresActiveToday(closures, timezone) {
  if (!closures || !Array.isArray(closures) || !timezone) return [];

  // Get today's date in snapshot's timezone (YYYY-MM-DD format)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  return closures.filter(c => {
    // 2026-04-16: Support both snake_case (normalized) and camelCase (legacy DB rows).
    // New data is normalized at ingestion in fetchSchoolClosures(); this covers older rows.
    const startDate = c.start_date || c.closureStart || c.startDate || c.closure_date || c.date;
    const endDate = c.end_date || c.reopeningDate || c.endDate || c.reopening_date || startDate;

    if (!startDate) return false;

    // Check: TODAY >= start_date AND TODAY <= end_date (inclusive)
    return today >= startDate && today <= endDate;
  });
}

/**
 * 2026-01-08: Format school closures as simple string list (NO JSON)
 * Output: "- Frisco ISD: Closed (Teacher In-Service)"
 * Uses snapshot.timezone directly
 * @param {Array} closures - Array of closure objects
 * @param {string} timezone - IANA timezone from snapshot
 * @returns {string} Simple formatted list
 */
function formatSchoolClosuresSummary(closures, timezone) {
  // Filter to closures active TODAY (start_date <= today <= end_date)
  const activeClosures = filterClosuresActiveToday(closures, timezone);

  if (!activeClosures || activeClosures.length === 0) {
    return 'None today';
  }

  // Simple string list format - NO JSON, minimal tokens
  const lines = activeClosures.slice(0, 10).map(c => {
    const name = c.schoolName || c.name || c.district || 'Unknown';
    const reason = c.reason || c.closure_reason || 'Closed';
    return `- ${name}: ${reason}`;
  });

  if (activeClosures.length > 10) {
    lines.push(`... and ${activeClosures.length - 10} more`);
  }

  return lines.join('\n');
}
```

### Schools card

Source: `client/src/components/briefing/SchoolClosuresCard.tsx`

```tsx
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Loader, Clock, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";

interface SchoolClosure {
  schoolName: string;
  closureStart: string;
  reopeningDate: string;
  type: 'district' | 'college';
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

interface SchoolClosuresData {
  school_closures?: SchoolClosure[];
  reason?: string;
  // 2026-07-06 (todo #24): pending/failed/verified-empty are three states
  _pending?: boolean;
  _generationFailed?: boolean;
}

interface SchoolClosuresCardProps {
  schoolClosuresData?: SchoolClosuresData;
  isSchoolClosuresLoading: boolean;
}

// 2026-02-18: FIX - Added isSchoolClosuresLoading prop to match Traffic/Airport/News loading pattern
export function SchoolClosuresCard({ schoolClosuresData, isSchoolClosuresLoading }: SchoolClosuresCardProps) {
  const [expandedClosures, setExpandedClosures] = useState(true);

  const allClosures = schoolClosuresData?.school_closures || [];
  const closuresReason = schoolClosuresData?.reason || null;

  // Show closures that are currently active OR start within next 30 days
  const isClosureRelevant = (closure: SchoolClosure): boolean => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const reopeningDate = new Date(closure.reopeningDate);
      reopeningDate.setHours(0, 0, 0, 0);
      return reopeningDate >= today;
    } catch {
      return true;
    }
  };

  const schoolClosures = allClosures.filter(isClosureRelevant);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200" data-testid="school-closures-card">
      <CardHeader className="pb-2 cursor-pointer hover:bg-purple-100/50 transition-colors" onClick={() => setExpandedClosures(!expandedClosures)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {!schoolClosuresData ? (
              <Loader className="w-5 h-5 animate-spin text-purple-600" />
            ) : (
              <>
                <BookOpen className="w-5 h-5 text-purple-600" />
                School Closures
                {schoolClosures.length > 0 && (
                  <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 ml-2">
                    {schoolClosures.length}
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          {expandedClosures ? <ChevronUp className="w-4 h-4 text-purple-600" /> : <ChevronDown className="w-4 h-4 text-purple-600" />}
        </div>
      </CardHeader>
      {expandedClosures && (
        <CardContent>
          {isSchoolClosuresLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-purple-600 mr-2" />
              <span className="text-gray-600">Loading school closures...</span>
            </div>
          ) : schoolClosures.length > 0 ? (
            <div className="space-y-3">
              {schoolClosures.map((closure, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-3 bg-gradient-to-r from-purple-50 to-blue-50"
                  data-testid={`closure-${closure.type}-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{closure.schoolName}</p>
                        <Badge variant="outline" className="text-xs">
                          {closure.type === 'college' ? '🎓 College' : '🏫 District'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{closure.reason}</p>
                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-gray-500" />
                          <span>Closed: {formatDate(closure.closureStart)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-green-600" />
                          <span>Reopens: {formatDate(closure.reopeningDate)}</span>
                        </div>
                      </div>
                    </div>
                    <Badge className={`${
                      closure.impact === 'high' ? 'bg-red-100 text-red-700' :
                      closure.impact === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {closure.impact} impact
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : schoolClosuresData?._generationFailed ? (
            // Failed ≠ empty: show the recorded reason, never "no closures" (todo #24)
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>School closure data couldn't be retrieved{closuresReason ? ` — ${closuresReason}` : ''}.</span>
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">
              {closuresReason || 'No school closures reported'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
```

### Briefing timezone handoff

The former `client/src/components/BriefingTab.tsx` call did not pass its existing timezone into the card:

```tsx
      <SchoolClosuresCard schoolClosuresData={schoolClosuresData} isSchoolClosuresLoading={!!isSchoolClosuresLoading} />
```

