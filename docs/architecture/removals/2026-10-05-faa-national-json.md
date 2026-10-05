# FAA national JSON adapter — October 5, 2026

1. `server/lib/external/faa-asws.js`: retired the XML/ASWS paired fetch, per-airport ASWS parser, database-driven national ASWS fanout, and associated merge helpers. The FAA website currently consumes [airport-events JSON](https://nasstatus.faa.gov/api/airport-events), as confirmed in its [current first-party client](https://nasstatus.faa.gov/static/js/main.3a4faa14.chunk.js). One bounded national request supplies overlapping airport reads. The legacy XML link still responds; a migration/retirement of ASWS was not established merely from observed HTTP502 responses. No API credentials are sent.

2. Removed comments below are retained verbatim by line from the former file at `7a1a7680e6c531d6ce36d73d109d0c2fdb23aeb4`. The previous code remains in that revision. Current null/unknown, simultaneous disruption and restriction-scope guarantees remain; ASWS-specific coverage/weather are no longer inferred. Source timestamps now describe advisory updates, separately from fetch time. An airport absent from the feed is not verified normal.

```javascript
// Using Node.js built-in fetch (available in Node 18+)
// 2026-09-10 (Melody): Briefing must surface failed providers, not infer normal
// operations from missing data. Legacy snapshot callers retain the nullable API.
      // 2026-08-06: the feed's other two list types were silently ignored —
      // verified live: an active MCO/DCA/LGA ground stop and 43-90min SFO/JFK
      // ground delays were invisible to the app. Ground stops mean no arrivals
      // (no pickup queue) — the most driver-relevant signal in the feed.
    // 2026-08-06: one airport can appear in multiple lists (e.g. a ground stop
    // AND arrival delays). The downstream merges use find()/Map.set() which take
    // one entry per code — combine here so nothing is dropped.
      // 2026-09-11: null-aware — unknown minutes never collapse to 0, and any listed
      // disruption keeps has_delays true across the merged entry.
      // 2026-09-11: closure_status retains an observed scoped restriction while
      // ground_stops independently retains the concurrent stop. Feed order must
      // not attach restriction times to a stop while dropping the restriction.
    // Retain distinct source reasons without choosing the first feed list as
    // authoritative. Sorting makes the summary independent of list order.
    // FAA ASWS per-airport endpoint verified anonymously on 2026-09-10.
    // Do not send unrelated/legacy Basic credentials to a public data endpoint.
    // 2026-07-06: US majors from the airports table (Google-seeded), not a
    // hardcoded list. Dynamic import avoids a module cycle at load time.
  // 2026-09-11 (Astra FAA producer finding, verified): a public delay-list entry with a
  // reason but no numeric duration used to become delay_minutes 0, and the merge then let
  // an optimistic ASWS Delay:false turn it into "no delays". Unknown minutes stay null and
  // the entry's presence is itself the disruption signal (has_delays: true).
// 2026-08-06: "1 hour and 32 minutes" / "43 minutes" → total minutes
// 2026-09-11: null (unknown) when the feed gives no parseable duration — never 0.
    // ASWS can report a delay before the aggregate feed contains its minutes; and the
    // public feed can list a disruption whose minutes are unknown while ASWS still says
    // Delay:false (2026-09-11, Astra finding). A listed public disruption wins; unknown
    // minutes stay null instead of borrowing ASWS's optimistic zero.
// 2026-09-10: Replace weather-only zero-delay defaults with the same observed
// status merge used for individual airports. Previous implementation is in Git.
// 2026-07-06 (todo #22): getMajorUSAirports + getNearestMajorAirport DELETED.
// They were a hardcoded 20-airport US-only list with coordinates baked into
// code (app_rules no-hardcoded-location violation; Austin/Nashville/San Diego
// missing entirely). Airport identity now lives in the airports table (seeded
// from Google Places by scripts/seed-airports.mjs) and selection goes through
// server/lib/location/airports.js findNearbyAirports (AIRPORT_RADIUS_MILES).
```

3. `server/lib/external/README.md`: replaced the September10 description requiring successful XML and ASWS responses. Removed text: “Briefing requires successful responses; unsupported airport coverage is represented explicitly, with a reason, rather than as an outage or an inferred normal status.” After Melody's October 5 clarification, FAA supplies conditions first; Gemini researches conditions only where usable FAA observations are missing, then a separate terminal pass consumes the chosen conditions without replacing them. Adapter strict callers still receive errors, and nullable callers receive null.

4. `server/lib/ai/providers/consolidator.js`: retired the Airport formatter that recognized legacy delay names and otherwise claimed normal operations, plus unsupported surge inferences. The current shared Airport formatter preserves present status values, FAA observations and uncertainty. Former block (base revision, lines692–741):

```javascript
/**
 * 2026-02-26: Simplified airport data — generate travelImpact summary, strip source noise.
 * Handles both single airport and multi-airport (airports array) formats.
 */
function optimizeAirportForLLM(airport) {
  if (!airport) return 'No airport data';

  // Handle airports array format from fetchAirportConditions()
  const airports = airport.airports || [];
  if (airports.length === 0 && !airport.code) {
    return airport.recommendations || 'No airport data available';
  }

  // Single airport (legacy) or first airport from array
  const primary = airports[0] || airport;
  const code = primary.code || airport.code || airport.airport_code || '???';
  const delays = primary.delays || airport.delays || airport.delay_status || 'normal operations';
  const status = primary.status || 'normal';
  const busyTimes = primary.busyTimes || [];
  const recommendations = airport.recommendations || '';

  // Generate concise travelImpact summary
  const parts = [`${code}:`];

  if (status === 'severe_delays') {
    parts.push(`severe delays (${delays}) — high surge at terminal pickup`);
  } else if (status === 'delays') {
    parts.push(`delays (${delays}) — moderate surge opportunity`);
  } else {
    parts.push('normal operations');
  }

  if (busyTimes.length > 0) {
    parts.push(`Peak: ${busyTimes.slice(0, 2).join(', ')}`);
  }

  // Add other airports briefly
  if (airports.length > 1) {
    const others = airports.slice(1).map(a =>
      `${a.code || '???'}: ${a.status === 'delays' || a.status === 'severe_delays' ? a.delays : 'normal'}`
    );
    parts.push(others.join('; '));
  }

  if (recommendations) {
    parts.push(recommendations);
  }

  return parts.join('. ');
}
```

5. `server/lib/briefing/filter-for-planner.js`: retired `: (filteredBriefing.airport.summary || 'Normal operations');`. Missing summary is not normal-operation evidence; the planner now uses the same observed Airport contract as the Strategist. No additional model call is introduced.

6. `server/lib/briefing/pipelines/airport.js`: replaced the previous combined conditions/terminal prompt and strict FAA prerequisite. The intermediate concurrent-research draft was not deployed. Melody identified that independently researching conditions again could cause conflicting corrections; the final flow resolves conditions once per airport and runs terminal research afterward. The old prompt and terminal-inventory rationale remain in the base revision. Terminal inventory, Clear availability and server-computed best-entry logic are preserved.
