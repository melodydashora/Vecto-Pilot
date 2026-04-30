# Clear Console Workflow Without Deferral

## Executive summary

Nothing that directly affects console clarity should be deferred.

The strongest finding from the current Vecto-Pilot logging review is that the visible console contract should become the first-class deliverable immediately.

At `info`, the console should show only the ordered business workflow.

At `debug`, it can show diagnostics.

Repetitive component chatter should be suppressed or summarized immediately for the worst offenders:

- Bars
- SSE
- Map diagnostics
- Block filtering
- Briefing/event dedupe spam
- Venue enrichment chatter

The current issue is not only server-side. Noise is spread across both server and browser consoles.

Server-side noisy areas include:

- `server/logger/workflow.js`
- `server/logger/logger.js`
- `server/logger/ndjson.js`
- `server/lib/ai/model-registry.js`
- `server/lib/venue/venue-cache.js`
- briefing/event dedupe routes
- SSE and DB listener logs

Client-side noisy areas include:

- `client/src/components/strategy/StrategyMap.tsx`
- `client/src/hooks/useBarsQuery.ts`
- `client/src/utils/co-pilot-helpers.ts`

The correct direction is:

1. Make the waterfall visible.
2. Do not number the waterfall.
3. Actual Results from calls and what is sent to calls should go to tests folder with current data.
4. Preserve warnings and errors.
5. Add enough structure to detect duplicate or out-of-order calls.

## Core finding

The console should not show scattered subsystem activity as if it were the primary workflow.

# The app should emit a clear waterfall using chaining tags:

A. Logs should not show model names or locations, nothing except verification run successful with why

***Example of what is in logs: [CONFIG] [ENV] [VALIDATION] AI Model Configuration {
  strategist: 'claude-opus-4-7',
  briefer: 'gemini-3.1-pro-preview',
  consolidator: 'gpt-5.4'
}
*** Would instead be: [CONFIG] [ENV] [VALIDATION] AI Model Configuration: strategist, briefer, planner, filterer assigned etc (naming conventions need to be solidified and used across code and comments. Right now there is confusion around consolidator and tactical planner.

B. Always on the left - they describe only the phase occurring and should not be shown in the logs out of     order as that would certify non waterall method or catagorized incorrectly
C. Should be in all caps surrounded by brackets [] 
D. Should start chain and categorize the actions


### Level 1 Tags (not exclusive) - Non-Functional Catagory Name

1. AUTH
2. USERS
3. LOCATION
4. SNAPSHOT
5. BARS
6. BRIEFING
7. EVENTS
8. STRATEGY
9. SIRI SHORTCUT
10. TRANSLATION
11. RIDESHARE COACH
12. VENUES
13. WATERFALL COMPLETE

### Level 1 Tags - System (Always before Non-Functional Tags)

1. CONFIG
2. GATEWAY
3. BOOT
4. AGENT EMBED
5. UNIFIED AI
6. TTS (AUTH)
7. HEALTH

   

### Level 2 and below Tags appear after Level 1 Tags and can be level 1 tags as well - these show what part of the workflow is causing an action to happen

1. API
2. DB
3. AI
4. EVENTS
5. NEWS
6. WEATHER FORCAST
7. SCHOOL CLOSURES
8. BRIEFIER
9. STRATEGIST
10. PLANNER
11. VENUE SCORER
12. FILTERING AGENT

### Level 2 System Tags

1. ENV
2. TTS

### Level 3 Tags and or Table names

A. If its a table action should include field name 

### Action Tags

1. DEDUP
2. FILTER
3. ENRICHMENT
4. VALIDATION



Table Names

1. actions 
2. app_feedback 
3. assistant_memory ***Delete
4. auth_credentials 
5. block_jobs 
6. briefings 
7. claude_memory 
8. coach_conversations 
9. coach_system_notes  
10. concierge_feedback 
11. connection_audit 
12. coords_cache 
13. countries 
14. cross_thread_memory 
15. discovered_events 
16. driver_goals 
17. driver_profiles 
18. driver_tasks ****Delete 
19. driver_vehicles 
20. eidolon_memory 
21. eidolon_snapshots 
22. http_idem 
23. intercepted_signals 
24. llm_venue_suggestions 
25. market_cities 
26. market_intel 
27. market_intelligence 
28. markets 
29. news_deactivations 
30. oauth_states 
31. offer_intelligence 
32. places_cache 
33. platform_data 
34. ranking_candidates 
35. rankings 
36. safe_zones 
37. snapshots 
38. staging_saturation 
39. strategies 
40. strategy_feedback 
41. traffic zones 
42. travel_disruptions 
43. triad_jobs 
44. uber_connections 
45. user_intel_notes
46. users
47. vehicle_makes_cache 
48. vehicle_models_cache
49. venue_catalog 
50. venue_events 
51. venue_feedback 
52. venue_metrics 
53. verification_codes
54. zone_intelligence

BRIEFING_DEDUP, EVENTS_DEDUP

The ordering rule should be strict:

- Snapshot cannot begin until authentication is complete
- Briefing cannot begin until Snapshot is complete.
- Strategy cannot begin until Briefing is complete.
- Venue Planning cannot begin until Strategy is complete.
- Waterfall Complete cannot emit until Venue Planning is complete.

Bars and lounges are the exception. They are auxiliary and currently scattered throughout the logs. Until the major workflow is visually proven clean, bars and lounges should be quiet by default or shown only as one summary line.

## Desired normal console shape

At normal `LOG_LEVEL=info`, the console should show chain of workflow

```text
AUTH -> SIGN IN -> PERMISSION GRANTED -> SNAPSHOT STARTED
SNAPSHOT -> API -> WEATHER 
SNAPSHOT <- WEATHER returned ok
SNAPSHOT -> DB -> SNAPSHOTS.status ok
BRIEFING <- SNAPSHOT id received
BRIEFING -> AI -> EVENT_DISCOVERY -> DB -> VENUE_CATALOG -> API -> EVENT_DISCOVERY  

## Desired chain definitions

- Hightest Levels

-- Configuration labels such as gateway, boot, agent, health, pid assignment not exclussive should stay ----- exactly how it is.


That is the console contract. 

Every visible line should answer one of these questions:

- What phase are we in?
- Did the phase start?
- Did the phase complete?
- Did the phase fail?
- How long did it take?


Everything else belongs in debug.

## What should disappear from normal logs

The following should not appear at normal info level:

```text
 from weekdayDescriptions



Those are diagnostics which are workflow milestones as workflow is fail hard.

They should become:

Chain of events that can be understood as aligned workflow and developers rules and requirements are better understood.


## Recommended implementation

### 1. Upgrade `workflow.js` into the central gated emitter

Add:

- `LOG_LEVEL=debug|info|warn|error`
- `LOG_QUIET_COMPONENTS= list each of the following chain tags by single data points returned we don't want to see every bar name or venue name listed in the console BARS,VENUES,SSE,DB,BRIEFING_DEDUP`
- `LOG_VERBOSE_COMPONENTS=BARS,VENUES,SSE,DB`
- `LOG_FORMAT=pretty|json|both`
- `withContext({ request_id, snapshot_id, route })`
- `debug()` as a first-class method
- summary-based burst suppression for selected noisy components

Warnings and errors should always emit unless there is a very explicit override. Do not silently swallow failures.

### 2. Enforce waterfall phases

Use a fixed phase taxonomy but do not use numbers:

```js
const WATERFALL_PHASES = {
  SNAPSHOT: {
    index: 1,
    total: 5,
    label: 'SNAPSHOT',
  },
  BRIEFING: {
    index: 2,
    total: 5,
    label: 'BRIEFING',
  },
  STRATEGY: {
    index: 3,
    total: 5,
    label: 'STRATEGY',
  },
  VENUE_PLANNING: {
    index: 4,
    total: 5,
    label: 'VENUE_PLANNING',
  },
  WATERFALL: {
    index: 5,
    total: 5,
    label: 'WATERFALL',
  },
};
```

Every major request should produce:

```text
[1/5 SNAPSHOT] Start
[1/5 SNAPSHOT] Complete
[2/5 BRIEFING] Start
[2/5 BRIEFING] Complete
[3/5 STRATEGY] Start
[3/5 STRATEGY] Complete
[4/5 VENUE_PLANNING] Start
[4/5 VENUE_PLANNING] Complete
[5/5 WATERFALL] Complete
```

If any phase starts out of order, emit a warning:

```text
WARN [3/5 STRATEGY] Started before BRIEFING complete req=a91f3d2c snap=7b8c12aa
```

This is the key diagnostic win.

## Minimal logger shape

```js
// server/logger/workflow.js

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FORMAT = process.env.LOG_FORMAT || 'pretty';

const QUIET = new Set(
  (process.env.LOG_QUIET_COMPONENTS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

const VERBOSE = new Set(
  (process.env.LOG_VERBOSE_COMPONENTS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

function shouldEmit(level, component) {
  const normalized = String(component || '').toUpperCase();

  if (level === 'error' || level === 'warn') {
    return true;
  }

  if (VERBOSE.has(normalized)) {
    return true;
  }

  if (QUIET.has(normalized)) {
    return false;
  }

  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function makeEvent(level, payload) {
  return {
    ts: new Date().toISOString(),
    level,
    component: payload.component,
    phase: payload.phase,
    phase_index: payload.phase_index,
    phase_total: payload.phase_total,
    message: payload.message,
    request_id: payload.request_id,
    snapshot_id: payload.snapshot_id,
    route: payload.route,
    meta: payload.meta || {},
  };
}

function formatPretty(evt) {
  const phase =
    evt.phase_index && evt.phase_total
      ? `${evt.phase_index}/${evt.phase_total} ${evt.phase}`
      : evt.phase || evt.component;

  const context = [
    evt.request_id ? `req=${evt.request_id}` : null,
    evt.snapshot_id ? `snap=${evt.snapshot_id}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const suffix = context ? ` ${context}` : '';

  return `${evt.ts} ${evt.level.toUpperCase()} [${phase}${suffix}] ${evt.message}`;
}

function emit(level, payload) {
  if (!shouldEmit(level, payload.component)) {
    return;
  }

  const evt = makeEvent(level, payload);

  if (LOG_FORMAT === 'json' || LOG_FORMAT === 'both') {
    process.stderr.write(JSON.stringify(evt) + '\n');
  }

  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    const line = formatPretty(evt);
    const sink =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : console.log;

    sink(line);
  }
}

function withContext(context = {}) {
  return {
    debug(payload) {
      emit('debug', { ...context, ...payload });
    },
    info(payload) {
      emit('info', { ...context, ...payload });
    },
    warn(payload) {
      emit('warn', { ...context, ...payload });
    },
    error(payload) {
      emit('error', { ...context, ...payload });
    },
  };
}

module.exports = {
  emit,
  withContext,
};
```

## Immediate server-side migration targets

### `model-registry.js`

Current issue:

The logs look like duplicate model registrations because multiple roles can share the same underlying model. That is probably valid architecture, but the current log shape makes it look like repeated registration noise.

Change from multi-line info boxes to one debug line per role resolution:

```text
DEBUG [MODEL_REGISTRY] Resolved role=STRATEGY_TACTICAL provider=openai model=gpt-5.4
DEBUG [MODEL_REGISTRY] Resolved role=VENUE_SCORER provider=openai model=gpt-5.4
```

At info level, only emit a startup summary:

```text
INFO [MODEL_REGISTRY] Ready roles=12 providers=3 default_strategy=claude-opus-4-7
```

### `venue-cache.js`

Current issue:

Venue enrichment emits repeated raw lines:

```text
[venue-cache] Enriched venue ... from Places API
```

Change routine enrichment to debug:

```text
DEBUG [VENUES] Enriched venue venue_id=... phone=true rating=4.8 hours=false
```

At info level, emit one summary:

```text
INFO [VENUES] Enrichment complete checked=24 enriched=4 with_hours=20 missing_hours=4
```

### Bars and lounges

Current issue:

Bars emit a long per-venue dump:

```text
🍺 [BARS] "WB's Table" - Calculated is_open=false from weekdayDescriptions
🍺 [BARS] "The Brass Tap - Frisco" - Could not find Monday in weekdayDescriptions
```

Change to debug-only.

At info level, emit one summary:

```text
INFO [BARS] Summary returned=24 open=1 closed=12 unknown_hours=4 missing_weekday=7
```

If bars are not part of the main waterfall, make them quiet by default during diagnostic sessions:

```bash
LOG_QUIET_COMPONENTS=BARS
```

### Briefing dedupe

Current issue:

The dedupe logic emits both structured and raw lines repeatedly:

```text
[DEDUP] Merged 2 variants → kept ...
[BriefingRoute] Dedup: 50 → 44 events
[BriefingRoute] Semantic dedup: 44 → 38 events
```

Change to:

```text
INFO [2/5 BRIEFING] Events deduped raw=50 normalized=44 semantic=38 removed=12
```

Move individual merge pairs to debug:

```text
DEBUG [BRIEFING_DEDUP] Merged variants kept="Grand Park Groundbreaking" dropped="Grand Park Groundbreaking Ceremony"
```

### SSE and DB listeners

Current issue:

Connection/subscriber churn clutters the main workflow:

```text
📡 [SSE 1/1] SSE /events/strategy connected (2 active)
💾 [DB] Channel strategy_ready: 2 subscriber(s)
```

Change routine connection churn to debug.

At info level, only emit startup readiness:

```text
INFO [SSE] Ready endpoints=4
INFO [DB] LISTEN ready channels=8
```

Warnings still emit:

```text
WARN [SSE] Client disconnected unexpectedly endpoint=/events/strategy
ERROR [DB] LISTEN connection failed channel=strategy_ready
```

## Immediate client-side migration targets

### `StrategyMap.tsx`

Current issue:

Map and bar marker logs are visible during normal use.

Add:

```ts
const DEBUG_MAP = import.meta.env.VITE_DEBUG_MAP === 'true';
const DEBUG_VENUES = import.meta.env.VITE_DEBUG_VENUES === 'true';
```

Then gate:

```ts
if (DEBUG_VENUES) {
  console.debug(`[StrategyMap] Added ${bars.length} bar markers`);
}
```

Map lifecycle diagnostics should use `DEBUG_MAP`.

Bars and venue diagnostics should use `DEBUG_VENUES`.

### `useBarsQuery.ts`

Current issue:

Bars prefetch start/completion logs are not workflow milestones.

Gate them:

```ts
const DEBUG_VENUES = import.meta.env.VITE_DEBUG_VENUES === 'true';

if (DEBUG_VENUES) {
  console.debug('[useBarsQuery] Prefetching bars', { city, radius });
}
```

### `co-pilot-helpers.ts`

Current issue:

SSE subscription churn and block-filter decisions appear in the browser console.

Gate with:

```ts
const DEBUG_SSE = import.meta.env.VITE_DEBUG_SSE === 'true';
const DEBUG_BLOCKS = import.meta.env.VITE_DEBUG_BLOCKS === 'true';
```

Then route:

```ts
if (DEBUG_SSE) {
  console.debug('[SSE] Reusing connection', { endpoint });
}

if (DEBUG_BLOCKS) {
  console.debug('[BlockFilter] Decision', { blockId, keep, reason });
}
```

## Burst suppression policy

Do not defer safe suppression.

Add component-scoped burst suppression now.

Rules:

- Never suppress `warn` or `error` by default.
- Suppress only selected noisy components.
- Suppression must emit a summary line.
- Suppression should key by message template, not raw full text.
- Request and snapshot context should remain visible.

Suggested components:

```js
const SUPPRESSIBLE_COMPONENTS = new Set([
  'BARS',
  'VENUES',
  'SSE',
  'DB',
  'BRIEFING_DEDUP',
  'MAP',
  'BLOCK_FILTER',
]);
```

Example behavior:

```text
DEBUG [BARS] "WB's Table" calculated open=false
DEBUG [BARS] "Kinzo" calculated open=false
DEBUG [BARS] "Barrel House" calculated open=false
INFO  [BARS] Suppressed 21 similar debug messages in last 10s
```

Better info-level behavior:

```text
INFO [BARS] Summary returned=24 open=1 closed=12 unknown_hours=4 missing_weekday=7
```

## Output routing

Support:

```bash
LOG_FORMAT=pretty
LOG_FORMAT=json
LOG_FORMAT=both
```

Recommended behavior:

- `pretty`: human console only
- `json`: structured events only
- `both`: pretty to stdout, JSON to stderr

This keeps `jq` and log pipelines clean while preserving readable local console output.

Example JSON event:

```json
{
  "ts": "2026-04-27T15:32:14.228Z",
  "level": "info",
  "component": "WATERFALL",
  "phase": "WATERFALL",
  "phase_index": 5,
  "phase_total": 5,
  "message": "Complete",
  "request_id": "a91f3d2c",
  "snapshot_id": "7b8c12aa",
  "route": "/api/strategy/blocks",
  "meta": {
    "total_ms": 4127
  }
}
```

## Waterfall order guard

Add a lightweight in-memory order guard per request/snapshot.

Pseudo-shape:

```js
const phaseState = new Map();

const ORDER = {
  SNAPSHOT: 1,
  BRIEFING: 2,
  STRATEGY: 3,
  VENUE_PLANNING: 4,
  WATERFALL: 5,
};

function markPhaseStart({ request_id, snapshot_id, phase }) {
  const key = `${request_id || 'unknown'}:${snapshot_id || 'unknown'}`;
  const next = ORDER[phase];

  const state = phaseState.get(key) || {
    completed: new Set(),
    started: new Set(),
  };

  for (const [name, index] of Object.entries(ORDER)) {
    if (index < next && !state.completed.has(name)) {
      emit('warn', {
        component: 'WATERFALL',
        phase,
        phase_index: next,
        phase_total: 5,
        request_id,
        snapshot_id,
        message: `Started before ${name} complete`,
      });
    }
  }

  state.started.add(phase);
  phaseState.set(key, state);
}

function markPhaseComplete({ request_id, snapshot_id, phase }) {
  const key = `${request_id || 'unknown'}:${snapshot_id || 'unknown'}`;
  const state = phaseState.get(key) || {
    completed: new Set(),
    started: new Set(),
  };

  state.completed.add(phase);
  phaseState.set(key, state);
}
```

This makes out-of-order calls obvious immediately.

## Duplicate request guard

Add request/snapshot/phase duplication detection.

Example warning:

```text
WARN [2/5 BRIEFING req=a91f3d2c snap=7b8c12aa] Duplicate start detected count=2 first_seen_ms=814
```

This addresses the concern that briefing or strategy calls may be duplicated.

The point is not to block execution yet. The first step is to make duplicates impossible to miss.

## Recommended env defaults

For local diagnostic sessions:

```bash
LOG_LEVEL=info
LOG_FORMAT=pretty
LOG_QUIET_COMPONENTS=BARS,VENUES,SSE,DB,BRIEFING_DEDUP
VITE_DEBUG_MAP=false
VITE_DEBUG_VENUES=false
VITE_DEBUG_SSE=false
VITE_DEBUG_BLOCKS=false
```

For deep debugging:

```bash
LOG_LEVEL=debug
LOG_FORMAT=pretty
LOG_VERBOSE_COMPONENTS=BARS,VENUES,SSE,DB,BRIEFING_DEDUP
VITE_DEBUG_MAP=true
VITE_DEBUG_VENUES=true
VITE_DEBUG_SSE=true
VITE_DEBUG_BLOCKS=true
```

For structured capture:

```bash
LOG_LEVEL=debug
LOG_FORMAT=both
```

## Commit plan

### Commit 1: Core logger control plane

Title:

```text
chore(logs): add workflow levels and component filters
```

Scope:

- Add `LOG_LEVEL`
- Add `LOG_QUIET_COMPONENTS`
- Add `LOG_VERBOSE_COMPONENTS`
- Add `LOG_FORMAT`
- Add `withContext()`
- Add first-class `debug()`
- Preserve existing caller compatibility
- Never suppress warnings/errors by default

### Commit 2: Waterfall phase contract

Title:

```text
chore(logs): enforce numbered waterfall phases
```

Scope:

- Define 1/5 Snapshot
- Define 2/5 Briefing
- Define 3/5 Strategy
- Define 4/5 Venue Planning
- Define 5/5 Waterfall
- Add request/snapshot context
- Add duplicate phase-start detection
- Add out-of-order phase warnings

### Commit 3: Backend noise migration

Title:

```text
chore(logs): migrate noisy backend emitters to workflow logger
```

Scope:

- `model-registry.js`
- `venue-cache.js`
- briefing event dedupe route
- bars/lounges emitters
- venue enrichment emitters
- SSE/DB listener chatter

### Commit 4: Frontend console gates

Title:

```text
chore(logs): gate frontend diagnostics behind debug flags
```

Scope:

- `StrategyMap.tsx`
- `useBarsQuery.ts`
- `co-pilot-helpers.ts`
- add `VITE_DEBUG_MAP`
- add `VITE_DEBUG_VENUES`
- add `VITE_DEBUG_SSE`
- add `VITE_DEBUG_BLOCKS`

### Commit 5: Safe burst summaries

Title:

```text
chore(logs): summarize repeated noisy diagnostics
```

Scope:

- Component-scoped suppression
- Summary line after window
- No suppression for warn/error
- Opt-in only for noisy components

### Commit 6: Regression guard

Title:

```text
test(logs): snapshot clean waterfall console output
```

Scope:

- Add test for phase ordering
- Add test for duplicate start warning
- Add test for quiet components
- Add test that warnings/errors bypass quiet mode
- Add ESLint or grep guard for new raw `console.log` in app paths

## What should not be deferred

Do now:

- Numbered waterfall phases
- Bars/lounges quieting
- Briefing dedupe quieting
- SSE/DB debug demotion
- Frontend debug gates
- Duplicate phase-start warning
- Out-of-order warning
- Safe burst summaries

Do separately later:

- Real Loki deployment
- Datadog deployment
- Full OpenTelemetry collector rollout
- ECS taxonomy perfection
- Mass migration of every long-tail `console.log`

The console does not need a full observability platform to become readable.

The app needs a strict visible workflow contract.

## Bottom line

The user-facing diagnostic goal is correct:

The console should show the waterfall, not every subsystem thought.

Normal logs should prove this sequence:

```text
1. Snapshot start
1. Snapshot complete
2. Briefing start
2. Briefing complete
3. Strategy start
3. Strategy complete
4. Venue Planning start
4. Venue Planning complete
5. Waterfall complete
```

Any duplicate or out-of-order request should become obvious:

```text
WARN [2/5 BRIEFING] Duplicate start detected
WARN [3/5 STRATEGY] Started before BRIEFING complete
```

Bars, lounges, venue enrichment, dedupe internals, SSE churn, DB listener counts, map marker counts, and block-filter internals should not appear in normal logs.

They should be debug-only, component-gated, or summarized.

That is the crisp clean workflow.
