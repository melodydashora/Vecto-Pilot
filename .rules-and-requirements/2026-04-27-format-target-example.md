# Format target — annotated session log (2026-04-27)

This is Melody's hand-annotated example of what the console should look like in steady-state operation. It's a captured log of a real session BEFORE the spec's Commit 3 migration was active (so the noisy bars/lounges/venue-cache lines are still visible — those should disappear after a server restart that picks up the migrated code).

The annotations Melody added inline (in parentheses) mark observations and concerns, not instructions to log them.

---

## FOUNDATIONAL PRINCIPLE (added 2026-04-27 — load-bearing rule)

> **Everything needs to be related to the main categories.**

Every log line in the console MUST be classifiable under a top-level main category. The bracket chain encodes this rule structurally — the leftmost bracket is always a main category, with optional sub-categories nesting to the right.

**Main categories** (the only valid leftmost brackets):
- `[BOOT]`, `[CONFIG]`, `[GATEWAY]`, `[AGENT]`
- `[AUTH]`
- `[SNAPSHOT]`, `[BRIEFING]`, `[STRATEGY]`, `[VENUE]`, `[WATERFALL]`
- `[EVENTS]`, `[BARS]`

Anything else (`[DB]`, `[SSE]`, `[LISTEN/NOTIFY]`, `[DEDUP]`, `[GET TODAY]`, `[RUN SCRIPT]`, `[WEATHER]`, `[TRAFFIC]`, `[NEWS]`, `[AIRPORT]`, `[SCHOOL CLOSURES]`, `[EXECUTED]`, `[SUMMARY]`, `[STATUS]`, `[PHASE]`, etc.) is a **sub-category** that may only appear AFTER a main category — never as the leftmost bracket.

**Examples that follow the rule:**
```
[BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY] briefing_weather_ready (first subscriber)
[EVENTS] [SSE] [PHASE] /events/phase connected
[STRATEGY] [LISTEN/NOTIFY] [DB] strategy_ready (first subscriber)
[BRIEFING] [EVENTS] [DEDUP] [EXECUTED] 3 variants of "Distinguished Speaker..."
[BRIEFING] [EVENTS] [DEDUP] [SUMMARY] Events deduped: 50 -> 44
```

**Examples that VIOLATE the rule (need migration):**
```
[BriefingRoute] GET /events: ...           ← "BriefingRoute" is a file name, not a category
[snapshot-get] {...}                       ← "snapshot-get" is a function name, not a category
[venue-cache] Enriched venue ...           ← "venue-cache" is a module name, not a category
[DB] Channel briefing_ready: 2 ...         ← "DB" alone has no main-category parent
[SSE Manager] connection error             ← "SSE Manager" is a class name, not a category
```

The corrected forms:
```
[BRIEFING] [EVENTS] [GET TODAY] today=2026-04-27, endDate=...
[SNAPSHOT] [GET] city=Frisco, weather=true, ...
[VENUE] [CACHE] Enriched venue ... phone=true ...
[BRIEFING] [DB] Channel briefing_ready: 2 subscribers
[EVENTS] [SSE] connection error
```

**Implementation implications:**

1. The workflow logger is no longer optional — raw `console.log` in `server/`, `client/src/`, `gateway-server.js`, `scripts/start-replit.js`, etc. is a violation because it produces an unclassified line.
2. Commit 7 (regression guard) MUST include an ESLint rule that bans raw `console.log` in app paths.
3. Every existing raw `console.log` is on the migration backlog, not just the obviously-noisy ones.
4. New code MUST emit through the logger with a main-category tag.
5. The logger's API needs a hierarchical-tag emitter — single-bracket emitters are fine for top-level lines, but multi-bracket lines (the more specific ones) need an explicit `tags: string[]` mechanism.

---

## Format pattern observed

Brackets nest to narrow context. Each new bracket adds a sub-category:

```
[BOOT]                                    ← top-level
[CONFIG]                                  ← top-level
[GATEWAY]                                 ← top-level
[BRIEFING]                                ← top-level
[BRIEFING] [WEATHER]                      ← sub-category
[BRIEFING] [WEATHER] [DB]                 ← sub-sub-category
[BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY] ← operation type
[BRIEFING] [EVENTS] [DEDUP] [EXECUTED]    ← four-level chain
[EVENTS] [SSE] [PHASE]                    ← three-level chain
```

The chain reads top-down: the leftmost bracket is the dominant system; each subsequent bracket narrows to a specific subsystem, operation, or status.

**Case convention:** UPPERCASE in this example (BOOT, CONFIG, GATEWAY, BRIEFING, WEATHER, TRAFFIC, EVENTS, DEDUP). Earlier directives showed Title Case (`[Briefing]`); this example shows UPPERCASE consistently. This example is more recent — UPPERCASE wins.

---

## Categories observed in this example

| Category | Used for |
|---|---|
| `[BOOT]` | Deployment detection, env loading, port binding, app startup banner |
| `[CONFIG]` | Environment loader, credential reconstruction, validation |
| `[GATEWAY]` | HTTP server, route mounting, middleware, worker lifecycle |
| `[AGENT]` | Agent server mounting, WebSocket setup |
| `[BRIEFING]` | Briefing pipeline orchestration |
| `[BRIEFING] [WEATHER]` | Weather sub-pipeline |
| `[BRIEFING] [TRAFFIC]` | Traffic sub-pipeline |
| `[BRIEFING] [EVENTS]` | Events processing within briefing |
| `[BRIEFING] [NEWS]` | News fetching |
| `[BRIEFING] [AIRPORT]` | Airport status |
| `[BRIEFING] [SCHOOL CLOSURES]` | School closure detection |
| `[STRATEGY]` | Strategy generation, strategy_ready notifications |
| `[SNAPSHOT]` | Snapshot creation, observer script |
| `[SNAPSHOT] [RUN SCRIPT] [SNAPSHOT WORKFLOW OBSERVER]` | Observer script writes to snapshot.txt |
| `[BLOCKS]` | "Smart blocks" — Melody flagged this name needs definition or rename if not strategy.venues-related |
| `[BARS]` | Bar-specific operations |
| `[VENUES]` | Venue cache enrichment |
| `[EVENTS]` | Event processing as a SEPARATE pipeline from briefing |
| `[EVENTS] [DEDUP] [EXECUTED]` | Dedup operation completion |
| `[EVENTS] [DEDUP] [SUMMARY]` | Dedup summary line |
| `[DB]` | Database operations |
| `[DB] [LISTEN/NOTIFY]` | Postgres LISTEN/NOTIFY events |
| `[SSE]` | Server-Sent Event connection lifecycle |
| `[SSE] [PHASE]` | Phase events SSE channel |
| `[SSE] [STRATEGY]` | Strategy events SSE channel |
| `[SSE] [BLOCKS]` | Blocks events SSE channel |
| `[GET TODAY]` | GET /events for today's date range |

---

## Annotations Melody added inline

These are notes-to-self / observations, NOT instructions for the logger to emit them:

- **"(log in → GPS resolves → new snapshot created)"** — Trigger flow for snapshot creation. Documents the dependency chain.
- **"(Blocks need definition and named differently if not smart blocks related to strategy.venues)"** — Open question about whether `[BLOCKS]` is the right tag, or whether smart-blocks should fold into `[STRATEGY]` or `[VENUES]`. Decision pending.
- **"(shows out of order)"** — The briefing events GET TODAY line fires before the prior dedup execution lines complete. Real ordering bug, not a logging bug. Belongs in the AI pipeline audit (claude_memory row 203).
- **"[BRIEFING 2/3 - Briefing|Events]"** — Old format from before Commit 5 (phase numbering + sub-label in bracket). After server restart picks up the new code, these should read `[BRIEFING]` only.
- **"📡 [SSE] SSE /events/strategy connected (2 active) ← 📡"** — Old format with section emoji and OP suffix arrow. After Commit 5 + LOG_NO_EMOJI=true (default), these should be emoji-free.

---

## Implementation gap (what's not yet wired)

The current `workflow.js` (after Commits 1-5) supports:
- Single-bracket format: `[BRIEFING] message`
- Title-Case OR UPPERCASE display via `COMPONENT_LABELS` map (currently set to Title Case; switching to UPPERCASE is a one-map-edit change)
- Phase context via `withContext({ request_id, snapshot_id })`

The current logger does NOT yet support:
- **Hierarchical brackets** (`[BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY] message`) — would need a new `tags: string[]` parameter on `withContext` or a new `tagLog(tags, message)` helper that emits multiple brackets in chain.
- **UPPERCASE convention** — current `COMPONENT_LABELS` returns Title Case (`Briefing`); switching to UPPERCASE is trivial (`'BRIEFING'` instead of `'Briefing'` in the map).

---

## Recommended next-session steps

1. **Restart the gateway** to pick up Commits 3 + 5 — the noisy `[venue-cache]` and `🍺 [BARS]` per-venue lines should disappear automatically. If they still show, the migrations didn't take effect.
2. **Decide UPPERCASE vs. Title Case** — Melody's most-recent example uses UPPERCASE; switching `COMPONENT_LABELS` to UPPERCASE is a one-edit change.
3. **Implement hierarchical brackets** — Adds a `tags` array to `withContext()` payload OR a new top-level `tagLog(tags, msg, level?)` helper that emits `[A] [B] [C] msg`. Single function, no behavior change for existing callers.
4. **Migrate the remaining raw `console.log` callsites** that produce lines like `[BriefingRoute] GET /events: ...`, `[snapshot-get] {...}`, `[BARS]` start/complete banners — these aren't yet using the structured logger. They should call into `briefingLog.info()` / `snapshotLog.info()` / `barsLog.complete()` so they pick up the format gating.

---

## Captured log (full session)

The verbatim log Melody shared on 2026-04-27 is preserved below for diffing future runs against this baseline.

```
[BOOT] Deployment detection:
[BOOT] REPLIT_DEPLOYMENT: undefined
[BOOT] HOSTNAME: d74a7e1da564
[BOOT] Reserved VM mode - running full application
[BOOT] Local development mode - full BOOTstrap
[BOOT] Loaded .CONFIG
[BOOT] Cleared port 5000
[BOOT] Starting Vecto Pilot in MONO mode...
[BOOT] PORT=5000, NODE_CONFIG=production
[BOOT] ENABLE_BACKGROUND_WORKER=true
[BOOT] REPL_ID=set
[BOOT] SDK routes embedded in GATEWAY (no separate SDK process)
[BOOT] Worker lifecycle delegated to GATEWAY-server.js
[CONFIG] Reconstructing GCP service account credentials from individual CONFIG vars...
[CONFIG] GCP credentials written to /tmp/gcp-credentials.json
[CONFIG] project_id=quantum-fusion-486920-p2, client_email=vertex-express@quantum-fusion-486920-p2.iam.gserviceaccount.com
[CONFIG] Loaded: .CONFIG.local
[CONFIG] AI Model CONFIGuration: Complete
[CONFIG] CONFIG Environment validation passed
[GATEWAY] Starting BOOTstrap (PID: 13319)
[GATEWAY] Mode: MONO, Port: 5000
[GATEWAY] Bot blocker enabled (full protection)
[GATEWAY] Global rate limiting enabled (100/min API, 200/min health, 5/min realtime mint)
[GATEWAY] Health endpoints CONFIGured (/health, /ready, /healthz)
[GATEWAY] All routes and middleware loaded
[GATEWAY] HTTP [LISTEN/NOTIFY]ing on 0.0.0.0:5000
[GATEWAY] BOOTstrap completed in 3681ms
[BOOT] Health check passed
[BOOT] Server ready at http://0.0.0.0:5000

[EVENTS] [SSE] [PHASE] SSE /events/phase connected (1 active)
[EVENTS] [SSE] [STRATEGY] /events/strategy connected (1 active)
[EVENTS] [SSE] [BLOCKS] /events/blocks connected (1 active)
[LISTEN/NOTIFY] [DB] client connecting to Replit PostgreSQL

[SNAPSHOT] (log in → GPS resolves → new snapshot created)
[SNAPSHOT] [snapshot-get] id: abfbf6f9-d102-471a-9736-fad1194ef72b, city: Frisco, weather: true, aqi: 55, dayPart: morning
[SNAPSHOT] [RUN SCRIPT] [SNAPSHOT WORKFLOW OBSERVER]
[SNAPSHOT] [RUN SCRIPT] [SNAPSHOT WORKFLOW OBSERVER] user_id 2f22004b-c5cc-43c9-a5a6-02f50ccff571
[SNAPSHOT] [RUN SCRIPT] [SNAPSHOT WORKFLOW OBSERVER] current_snapshot_id abfbf6f9-d102-471a-9736-fad1194ef72b
[SNAPSHOT] [RUN SCRIPT] [SNAPSHOT WORKFLOW OBSERVER] last_snapshot_id <id> <DATE/TIME>

[LISTEN/NOTIFY] [DB] Waiting for ongoing connection...
[LISTEN/NOTIFY] [DB] client connected
[BLOCKS] [LISTEN/NOTIFY] [DB] [LISTEN/NOTIFY] blocks_ready (first subscriber)
[BLOCKS] [LISTEN/NOTIFY] [DB] Channel blocks_ready: 1 subscriber(s)
[LISTEN/NOTIFY] [DB] Notification dispatcher attached

[STRATEGY] [LISTEN/NOTIFY] [STATUS] [DB] [LISTEN/NOTIFY] strategy_ready (first subscriber)
[STRATEGY] [LISTEN/NOTIFY] [DB] Channel strategy_ready: 1 subscriber(s)

[BRIEFING] [EVENTS] [SSE] SSE /events/briefing connected (1 active)
[BRIEFING] [DB] [LISTEN/NOTIFY] briefing_ready (first subscriber)
[BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY] briefing_weather_ready (first subscriber)
[BRIEFING] [TRAFFIC] [DB] [LISTEN/NOTIFY] briefing_traffic_ready (first subscriber)
[BRIEFING] [EVENTS] [DB] [LISTEN/NOTIFY] briefing_events_ready (first subscriber)
[BRIEFING] [NEWS] [DB] [LISTEN/NOTIFY] briefing_news_ready (first subscriber)
[BRIEFING] [AIRPORT] [DB] [LISTEN/NOTIFY] briefing_airport_ready (first subscriber)
[BRIEFING] [SCHOOL CLOSURES] [DB] [LISTEN/NOTIFY] briefing_school_closures_ready (first subscriber)

[BRIEFING] [EVENTS] [GET TODAY] today=2026-04-27, endDate=2026-05-04, tz=America/Chicago (shows out of order)
[BRIEFING] [EVENTS] [DEDUP] [EXECUTED] 3 variants of "Distinguished Speaker Series: Jimmy Smit..."
[BRIEFING] [EVENTS] [DEDUP] [EXECUTED] 2 variants of "NHL Western Conference First Round: Dall..."
[BRIEFING] [EVENTS] [DEDUP] [SUMMARY] Events deduped: 50 → 44 (6 duplicates removed)

[EVENTS] [DEDUP] [EXECUTED] 2 variants → kept "NO LIMITS Karaoke" @ The Revel Patio Grill | dropped "Karaoke Night" @ Mama Tried
[EVENTS] [DEDUP] [SUMMARY] Semantic dedup: 44 → 38 events (removed 6 title-variant duplicates)

[BARS] START: Frisco, TX (25 mile radius)
[BARS] Found 24 cached venues in Frisco, TX
[BARS] 24 venues within 25 mile radius
[BARS] Backfilling hours for 4 venues missing data
[BARS] Using 24 cached venues (Cache First, 20 have hours)
[BARS] COMPLETE: 1 venues from cache (1 open)
```

(Per-venue [BARS] lines and [venue-cache] lines OMITTED above — those are exactly the noise that Commit 3 demoted to debug. After server restart picks up Commit 3, they should disappear from default-info output.)

---

## Status against this target as of session end

| Aspect | Status |
|---|---|
| Single-bracket category like `[BOOT]` | ✓ Working (`workflow.js` outputs `[Component]`) |
| Hierarchical bracket chain `[A] [B] [C]` | ✗ Not yet implemented — `workflow.js` only emits one bracket per line |
| UPPERCASE convention | Partial — `COMPONENT_LABELS` currently Title Case; one-edit switch |
| No emoji decoration | ✓ Default after Commit 5 (`LOG_NO_EMOJI=true`) |
| No phase numbering in bracket | ✓ Done in Commit 5 |
| No model names in messages | ✓ Already convention; no log line includes a model name except model-registry's resolution debug line |
| Per-venue/dedup lines silenced by default | ✓ Done in Commit 3 — pending server restart to take effect |
| Boot/route-mount chatter at info level | ✗ Not yet migrated — `gateway-server.js` and `bootstrap/*.js` still use raw `console.log` |
| `[BriefingRoute]` and `[snapshot-get]` raw lines | ✗ Not yet migrated to logger |
| `[BARS] START:` / `[BARS] COMPLETE:` banners | Mixed — `barsLog.start()` / `.complete()` exist but specific call sites haven't all been migrated |
