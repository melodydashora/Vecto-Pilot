# Current-State Atlas — 2026-04-27

Snapshot of the codebase before the "Clear Console Workflow" cleanup begins. This is the baseline we revert to if the cleanup goes sideways. The point of this exercise is to verify stragglers — every "raw `console.log` bypassing `workflow.js`" entry below is a known-current straggler that should disappear by the time the spec is fully implemented.

---

## Auth subsystem

### Source of truth

- **`client/src/contexts/auth-context.tsx`** — `AuthProvider`, owns `{ user, profile, vehicle, token, isAuthenticated, isLoading }`.
  - Persists token to `localStorage[AUTH_TOKEN]`.
  - Persists snapshot to `sessionStorage[SNAPSHOT]`.

### Key functions (auth-context.tsx)

| Function | Lines | Purpose |
|---|---|---|
| `AuthProvider` | 39 | Wraps children with context |
| Mount `useEffect` | 50–59 | Loads token from localStorage, fetches profile |
| `vecto-auth-error` handler | 64–108 | Force logout on server-side 401 |
| `fetchProfile(token)` | 110–144 | `GET /api/auth/me` |
| `login(credentials)` | 146–184 | `POST /api/auth/login`; sets token + atomic state |
| `register(data)` | 186–207 | `POST /api/auth/register`; **no auto-login** |
| `logout()` | 209–249 | Cancel queries → clear cache → close SSE → server logout → localStorage cleanup → atomic state reset |
| `refreshProfile()` | 251–255 | Re-runs `fetchProfile` |
| `updateProfile()` | 257–285 | `PUT /api/auth/profile`, then refetches |
| `getAuthHeader()` | 303–306 | Helper for outbound calls |

### Downstream auth-aware contexts

- **`client/src/contexts/location-context-clean.tsx`**
  - `prevTokenRef`-guarded effect at lines **226–265** clears all location state on auth=null.
  - `"Waiting for auth state to load..."` log at line 789.
- **`client/src/contexts/co-pilot-context.tsx`**
  - `prevAuthRef`-guarded effect at lines **143–162** clears snapshot/strategy on auth=null.
- **`client/src/components/auth/AuthRedirect.tsx`** — root-level routing.
- **`client/src/pages/auth/SignInPage.tsx`** — line **90–95**: post-login redirect.
- **`client/src/pages/auth/SignUpPage.tsx`** — line **212**: same pattern.

### Logout teardown order (verified-correct, do not modify casually)

1. `queryClient.cancelQueries()` — kills in-flight requests.
2. `queryClient.clear()` — drops cache.
3. `closeAllSSE()` — kills SSE connections.
4. `await POST /api/auth/logout` (best-effort).
5. `localStorage.removeItem(AUTH_TOKEN, PERSISTENT_STRATEGY, STRATEGY_SNAPSHOT_ID)`.
6. `sessionStorage.removeItem(SNAPSHOT)`.
7. `setState` atomic reset.

### Known unfixed issue

ErrorBoundary catches an exception during the logout transition. Boundary now logs `type/ctor/message/stack/snapshot` (commit `fa23e3af`). Reproduction needed.

---

## Logger framework

### Canonical logger

**`server/logger/workflow.js`** — 458 lines. Defines per-component pre-built loggers:

`locationLog`, `userLog`, `snapshotLog`, `triadLog`, `venuesLog`, `barsLog`, `briefingLog`, `eventsLog`, `weatherLog`, `aiLog`, `dbLog`, `authLog`, `sseLog`, `phaseLog`, `placesLog`, `routesLog`.

API surface per logger: `phase(n,msg,op?)`, `done(n,msg,ms?,op?)`, `error(n,msg,err?,op?)`, `warn(n,msg,op?)`, `start(ctx)`, `complete(summary,ms?)`, `info(msg,op?)`, `api/ai/db` convenience methods.

### Workflow phase taxonomy (already designed, not always used)

| Phase | Stages |
|---|---|
| LOCATION | 1/3 GPS Received → 2/3 Geocode/Cache → 3/3 Weather+Air |
| SNAPSHOT | 1/2 Create Record → 2/2 Enrich (Airport/Holiday) |
| TRIAD | 1/4 Strategy Strategist → 2/4 Strategy Briefer → 3/4 Strategy NOW → 4/4 Venue SmartBlocks |
| VENUES | 1/4 Tactical Planner → 2/4 Routes API → 3/4 Places API → 4/4 DB Store |
| BARS | 1/2 Query → 2/2 Enrich |
| BRIEFING | 1/3 Traffic → 2/3 Events → 3/3 Validation |
| EVENTS | 1/5 Extract Providers → 2/5 Transform Normalize → 3/5 Transform Geocode → 4/5 Load Store → 5/5 Assemble Briefing |

### Structured (workflow.js consumers — 10 files)

- `server/lib/ai/providers/briefing.js`
- `server/lib/ai/providers/consolidator.js`
- `server/lib/ai/adapters/index.js`
- `server/lib/ai/adapters/openai-adapter.js`
- `server/lib/briefing/briefing-service.js`
- `server/lib/briefing/cleanup-events.js`
- `server/lib/briefing/filter-for-planner.js`
- `server/lib/venue/enhanced-smart-blocks.js`
- `server/lib/external/serper-api.js`
- `server/lib/traffic/tomtom.js`

### Stragglers (unstructured `console.log` bypassing workflow.js — TARGETS FOR CLEANUP)

#### Server-side

| File | Approx count | Type |
|---|---|---|
| `server/lib/venue/venue-cache.js` | ~3 | `console.warn` |
| `server/lib/venue/district-detection.js` | ~4 | `console.log` |
| `server/lib/venue/event-matcher.js` | ~3 | `console.log` |
| `server/lib/venue/venue-event-verifier.js` | ~4 | `console.log/warn` |
| `server/lib/venue/venue-address-resolver.js` | ~5 | `console.warn` |
| `server/lib/venue/venue-enrichment.js` | ~3 | `console.log` |
| `server/lib/venue/hours/evaluator.js` | ~2 | `console.log` |
| `server/lib/ai/model-registry.js` | multi-line per-role | "duplicate registrations" perception |

#### Client-side

| File | Line(s) | Description |
|---|---|---|
| `client/src/components/strategy/StrategyMap.tsx` | 572 | event markers count |
| `client/src/components/strategy/StrategyMap.tsx` | 678 | bar markers count |
| `client/src/hooks/useBarsQuery.ts` | 109, 120 | prefetch start/complete |
| `client/src/utils/co-pilot-helpers.ts` | 716, 740, 757 | block filter decisions |
| `client/src/pages/co-pilot/StrategyPage.tsx` | 191 | NOW Strategy filter |

### Logger capability gaps (target for the cleanup)

- No level filter (debug/info/warn/error) — every method calls `console.log` directly.
- No env var to silence individual components (e.g., `LOG_QUIET=BARS`).
- No structured NDJSON output (only pretty).
- No context binding (request_id / snapshot_id correlation).
- No dedup or rate-limiting.

---

## AI model registry and routing

### Registry

**`server/lib/ai/model-registry.js`** defines roles + envKeys. Categories: `BRIEFING_*`, `STRATEGY_*`, `VENUE_*`, `AI` (generic).

### Briefing roles (lines 30–110)

| Role | envKey | Resolved model (from .env) |
|---|---|---|
| `BRIEFING_WEATHER` | `BRIEFING_WEATHER_MODEL` | Gemini |
| `BRIEFING_TRAFFIC` | `BRIEFING_TRAFFIC_MODEL` | Gemini Flash |
| `BRIEFING_NEWS` | `BRIEFING_NEWS_MODEL` | Gemini |
| `BRIEFING_EVENTS_DISCOVERY` | `BRIEFING_EVENTS_MODEL` | Gemini |
| `BRIEFING_FALLBACK` | `BRIEFING_FALLBACK_MODEL` | — |
| `BRIEFING_SCHOOLS` | `BRIEFING_SCHOOLS_MODEL` | — |
| `BRIEFING_AIRPORT` | `BRIEFING_AIRPORT_MODEL` | — |
| `BRIEFING_HOLIDAY` | `BRIEFING_HOLIDAY_MODEL` | — |

### Strategy roles (lines 120–148)

| Role | envKey | Resolved model |
|---|---|---|
| `STRATEGY_CORE` | `STRATEGY_CORE_MODEL` | Claude Opus |
| `STRATEGY_CONTEXT` | `STRATEGY_CONTEXT_MODEL` | Gemini |
| `STRATEGY_TACTICAL` | `STRATEGY_TACTICAL_MODEL` | gpt-5.5 |
| `STRATEGY_STRATEGIST` | `STRATEGY_STRATEGIST` | **Claude Opus (NOT GPT)** |
| `STRATEGY_CONSOLIDATOR` | — | gpt-5.5 |
| `STRATEGY_VENUE_PLANNER` | — | gpt-5.5 |

### Venue roles (lines 149–175)

| Role | envKey | Default |
|---|---|---|
| `VENUE_SCORER` | `VENUE_SCORER_MODEL` | gpt-5.5-2026-04-23 |
| `VENUE_FILTER` | `VENUE_FILTER_MODEL` | Claude Haiku |
| `VENUE_TRAFFIC` | `VENUE_TRAFFIC_MODEL` | Gemini |
| `VENUE_EVENT_VERIFIER` | `VENUE_EVENT_VERIFIER_MODEL` | — |

### Router

- **`server/lib/ai/llm-router-v2.js`** — routes role+model to provider adapter.
- **`server/lib/ai/adapters/index.js`** — adapter dispatcher.
- **`server/lib/ai/adapters/openai-adapter.js`** — OpenAI calls.
- (Anthropic / Gemini adapters in same dir per directory convention.)

### Architectural facts

- The same model can serve multiple roles (gpt-5.5 = `STRATEGY_TACTICAL` + `STRATEGY_CONSOLIDATOR` + `STRATEGY_VENUE_PLANNER` + `VENUE_SCORER`). **By design** (model-agnostic adapter pattern, CLAUDE.md Rule 14).
- Each role registers separately at startup. Logs say `Registered gpt-5.5 for STRATEGY_TACTICAL` / `Registered gpt-5.5 for VENUE_SCORER` etc. — **looks like duplicates but is one model serving four roles**.
- **`STRATEGIST` (the role) = Claude Opus, NOT GPT.** If logs show STRATEGIST handled by GPT, that's a real routing bug, not a config artifact.

### Open audit (memory row 203)

Need desktop session log capture to verify: (a) no role bleeds across categories at runtime, (b) waterfall ordering (Snapshot → Briefing → Strategy → Venue → Complete) holds with no out-of-order calls.

---

## What "verifying stragglers" means

After the spec in `2026-04-27-clear-console-workflow.md` is fully implemented, every entry under "Stragglers" above should be gone:

- Server-side: every raw `console.log` migrated to a `workflow.js` logger or an explicit debug-gated path.
- Client-side: every `console.log` gated behind a `VITE_DEBUG_*` flag.
- Model-registry: per-role registration moved to `debug` level, with one info-level summary at startup.

If after the cleanup a fresh `grep -rn "console\.\(log\|warn\)" server/lib client/src` still returns the entries above, the migration is incomplete.

That grep is the verification check — and (per the "no grep in three weeks" framing) it should produce zero hits at the end.
