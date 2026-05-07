# QUEUED PLAN: Three-tier schema refactor (Static Config / Volatile State / Historical Logs)

**Created:** 2026-05-07 (queued for 2026-05-08 or later)
**Updated:** 2026-05-07 late evening — Melody shared the target architecture diagram.
**Author:** Claude Code (Opus 4.7)
**Status:** **NOT YET PLANNED IN DETAIL.** Context-survival doc. The architectural target is now CONCRETE per Melody's diagram (§1.5 below). Implementation still needs its own dedicated plan with migration strategy, test plan, and code-change inventory.

---

## 1. The directive (Melody, 2026-05-07)

> users is the table to hold data when the user signs up, nothing should change. It's the one table that should not change. We have preferences for that (vehicle, name, etc.). Literal or not remove the code right, we leave nothing that doesn't make sense. **Session shouldn't even go to users, if anything user_id should go to session_id wherever that is stored.**
>
> tables got changed I don't know I will need to look and cross validate this. tomorrow

The doctrine reverses what `shared/schema.js:4-18` currently says ("users: Session (who's online now) - TEMPORARY (60 min TTL)"). The schema comment IS the architectural mistake; this plan corrects it.

## 1.5 Target architecture (from Melody's diagram, 2026-05-07)

Three tiers, each with one purpose. Schema enforcement & integrity via Zod contracts at the application edge.

### Tier 1: STATIC CONFIG (immutable / rarely changes)

```
users                              vehicles                       driver_preferences
─────────────────                  ──────────────────             ─────────────────────────
UUID user_id [PK]   ◄─FK──         UUID vehicle_id [PK]   ◄─FK──  UUID  user_id    [PK/FK]
email                              FK ──► users                   UUID  vehicle_id [FK]
name                                                              JSONB route_rules
```

### Tier 2: VOLATILE OPERATIONAL STATE (collapsed sessions + snapshots)

```
active_context                                  Drops on Session End ─► (deleted)
──────────────────────────────────────
VARCHAR session_token [PK]                      Split-Brain Feedback:
UUID    user_id    [FK, OPTIONAL for             - Combined Sessions + Snapshots
                       System Agent]               into active_context
JSONB   live_payload   [Zod Validated]           - Removes joins/bloat
```

### Tier 3: HISTORICAL LOGS (quarterly partitioned)

```
travel_telemetry (Quarterly Partitioned)        ─► Future Predictive Routing Models
─────────────────────────────────────────
UUIDv7  telemetry_id [PK]                       Split-Brain Feedback:
UUID    user_id      [FK, allows                 - Quarterly partitioning, not Monthly
                         SYSTEM_AGENT_USER_ID]    - No BIGSERIAL — UUIDv7 only
UUID    vehicle_id   [FK, nullable for Agent]    - Zod metrics contract
TZ      timestamp                                  enforced at edge
POINT   coordinates
JSONB   metrics      [Zod Enforced]
```

### Cross-cutting concerns from the diagram

- **Schema Enforcement & Integrity:** Zod contracts at the application edge for both JSONB fields (`live_payload` and `metrics`). The shape of these JSONB blobs is the source of truth's worth of complexity for the JSONB-validation strategy.
- **UUIDv7** (timestamp-ordered UUIDs): replaces BIGSERIAL for telemetry. Sortable without secondary index. Postgres support varies — may need an extension (`pg_uuidv7`) or application-side generation.
- **SYSTEM_AGENT_USER_ID:** a dedicated UUID that represents "the agent did this" rather than a real user. Telemetry rows need this for agent-driven actions; vehicle_id is nullable when the agent is acting without a vehicle context.
- **Quarterly partitioning** on `travel_telemetry`: 4 partitions per year, named like `travel_telemetry_2026_q1`. Older partitions can be archived/dropped wholesale without DELETE-row overhead.

### Mapping current → target

| Current | Target | Notes |
|---|---|---|
| `users.user_id` (PK) | `users.user_id` (PK) | unchanged |
| `users.session_id`, `users.current_snapshot_id`, `users.session_start_at`, `users.last_active_at`, `users.updated_at` | DROPPED | session moves to `active_context` |
| `users.created_at` | DROPPED? | "nothing should change" doctrine — created_at is fine, it doesn't change |
| `driver_profiles.email`, `driver_profiles.first_name + last_name` | `users.email`, `users.name` | promoted up to users |
| `driver_profiles` (vehicle fields) | `vehicles` table | new |
| `driver_profiles` (route_rules-equivalent: eligibility, attributes, preferences) | `driver_preferences.route_rules` JSONB | collapsed into JSONB |
| `driver_profiles` (address, phone, terms, marketing_opt_in) | TBD — may live on `users`, or new `users` JSONB, or stay on `driver_profiles` if that table survives | open question |
| `snapshots` (entire table — session linkage + event-log fields) | **Split:** session-state fields → `active_context.live_payload` (JSONB); coordinate/timestamp/metrics → `travel_telemetry` rows | per-snapshot fields decomposed across two new tables |
| `discovered_traffic` (FK to snapshots) | likely `travel_telemetry` companion or merged | TBD per refactor |
| `discovered_events` (FK to snapshots) | likely stays event-log-shaped, but the FK target changes from `snapshots` to `travel_telemetry` or `active_context` | TBD |
| `briefings` (FK to snapshots) | likely `active_context.live_payload` includes briefing data, OR briefings stays separate as another volatile table | TBD |
| `strategies` (FK to snapshots) | similar question | TBD |
| `ranking_candidates` (FK to snapshots/strategies) | similar | TBD |

The downstream FK chain is *deep* — anything that referenced `snapshots.snapshot_id` needs a new home or a migration of the FK target.

## 2. Current state (the wrong-shape we're correcting)

Live `users` table (verified 2026-05-07):
- `user_id` (PK, sign-up identity) ✅ keep
- `created_at` (sign-up timestamp) ✅ keep
- `session_id` ❌ should leave
- `current_snapshot_id` ❌ should leave
- `session_start_at` ❌ should leave
- `last_active_at` ❌ should leave
- `updated_at` ❓ **questionable** — if `users` never changes, what does it update for? Likely should leave too.

Code paths that read or write the session columns on `users`:
- `server/middleware/auth.js:165-212` — session lookup at every authenticated request, sliding-window enforcement at lines 201-212, hard-limit enforcement at 186-198.
- `server/api/auth/auth.js:412-424` (register), `:747-770` (login, two paths), `:1461` (logout), `:1637-1743` (Google OAuth).
- `server/api/location/location.js:1015-1019` (release old snapshot), `:1175-1185` (set new current_snapshot_id after creation), `:2031-2037` (snapshot V1 path).
- `server/api/location/snapshot.js:316`.

The `/resolve` UPDATE/INSERT blocks at `location.js:891-984` are being deleted in tonight's commit — they were dead-writing location fields to `users` and would have been moved out as part of this refactor anyway.

## 2.5 Additional doctrine note (Melody, 2026-05-07, late evening)

> It feels like we are using snapshot as a session table and they are two very separate things.

This expands the architectural boundary from **two tables (users, sessions)** to **three tables (users, sessions, snapshots)** — each with one purpose:

| Table | Purpose | Lifetime |
|---|---|---|
| `users` | Sign-up identity record | Immutable after registration |
| `sessions` (new — TBD where) | Who's online now, current session pointer | Ephemeral, replaced/expired |
| `snapshots` | Event log of point-in-time context captures (lat/lng + weather + time) | Forever (audit trail) |

Currently `snapshots` carries `session_id` + `user_id` (session linkage), making it act partly as a session table because every read needs to filter by snapshot ownership and recency. Per Melody's observation, `snapshots` should be PURE event-log: each row is "this is what was true at this moment" with no session-state semantics. Session state — including "what is the user's current snapshot?" — lives in the new sessions table, with `current_snapshot_id` as a FK pointer.

The implementation question this adds to §3 below: **which fields on `snapshots` are session-state vs. event-data?** `session_id` is clearly session-state. `user_id` could be either (event log of "user X did this" vs. session linkage). The answer informs whether `snapshots.session_id` and possibly `snapshots.user_id` get dropped or kept post-refactor.

## 3. Open architectural questions (NEED MELODY'S DECISIONS, NOT MINE)

Per Rule 16, Claude doesn't decide architecture. These need Melody's input before this plan can be detailed:

1. **Where do session columns live after this refactor?**
   - **Option A:** Create a new `sessions` table with `(session_id PK, user_id FK, current_snapshot_id, session_start_at, last_active_at, created_at, updated_at)`.
   - **Option B:** Extend an existing table (e.g., `driver_profiles`?) with the session columns. (Probably wrong — driver_profiles is identity, not session.)
   - **Option C:** Fold session into `snapshots` itself. Each snapshot already has `session_id` and `user_id`. A "current session" could be derived from the most-recent fresh snapshot. This eliminates a table at the cost of changing how session-liveness queries work.
   - **Option D:** Something else Melody has in mind from her cross-validation.

2. **Does `users.updated_at` survive?**
   - Per "nothing should change" on `users`, `updated_at` is meaningless and should be dropped along with the session columns.
   - But that's a column-drop migration, which is a heavier change.
   - Decision can defer if needed.

3. **What happens to "Highlander Rule"?**
   - `shared/schema.js:15` says: "Highlander Rule: One device per user (login on new device kills old session)". This was the old session-on-users doctrine. The new architecture might keep Highlander (one row per user in the sessions table) or relax it (multiple concurrent sessions per user).

4. **What happens to driver_profiles vs users boundary?**
   - Currently `driver_profiles` holds the actual sign-up data (first_name, last_name, email, phone, address_1, home_lat, home_lng, terms_accepted, etc.).
   - `users` holds session columns + an empty user_id (which is FK'd from driver_profiles).
   - Per Melody's "users is the table to hold data when the user signs up" — should driver_profiles be merged INTO users? Or is the current separation correct (users = identity ID, driver_profiles = sign-up data)?

5. **Migration strategy:**
   - Forward-only? Rollback plan?
   - Order: create new sessions table, dual-write for one deploy, switch reads, drop old columns. Or single-cutover (riskier)?
   - Existing rows: 90+ users in dev, real users in prod. Existing session columns on those rows need to migrate to the new structure or be dropped (with users logged out as side effect).

## 4. Scope estimate (revised after seeing the target diagram, 2026-05-07 late)

This is **2-3x larger** than the initial queued estimate. Capturing realistic scope:

- **Schema changes:** drop ~5 columns from `users`, create 4-5 new tables (`active_context`, `travel_telemetry` with quarterly partitions, possibly `vehicles`, possibly `driver_preferences` shaped differently from current `driver_profiles`). Decompose current `snapshots` table fields across `active_context.live_payload` and `travel_telemetry` rows. Decompose current `driver_profiles` across `users` (email, name), `vehicles`, `driver_preferences`.
- **Migration:** multi-step. Likely staged: (1) create new tables alongside old, (2) dual-write during transition, (3) backfill historical, (4) cut over reads, (5) drop old. Forward-only at scale; reversible only at the per-step boundary.
- **Code changes:** much wider than initial estimate. Touches auth, location, snapshot, briefing aggregator, strategy, venue planner, briefing pipelines, coach DAL, anywhere that does `db.select().from(snapshots)` (which is most of the read pipeline). Estimated 25-40 files.
- **New patterns to introduce:**
  - **UUIDv7 generation** — at application layer (need a deps decision: use `uuidv7` npm package, or `pg_uuidv7` extension if Helium/Neon support it).
  - **Zod contracts** for `live_payload` and `metrics` — these are big JSONB blobs that need explicit schemas. Zod is already in the project.
  - **Quarterly partitioning** in Postgres — declarative range partitioning on `travel_telemetry` with one child partition per quarter. Needs a partition-creation cron or pre-creation strategy.
  - **SYSTEM_AGENT_USER_ID** — reserved UUID, probably defined as a constant in `shared/`. Auth middleware needs to handle agent rows differently (or skip them, depending on use case).
- **Test coverage:** auth flow, session-token lookup, telemetry insert under load, partition routing, Zod-validation rejection at edge, JSONB shape integrity, FK migration of every snapshot consumer.
- **Doc cascade:** CLAUDE.md (Rule 11 snapshot fidelity — semantic shifts; Rule 12 priority list rewrites; Rule 13/18 environment doctrine remains; new section on three-tier model), LESSONS_LEARNED.md, schema.js comments, ARCHITECTURE.md, every sub-README that mentioned snapshots.

**Estimated commit shape:** NOT a single commit. Probably a series of 4-6 PRs over 1-2 weeks: (1) introduce new tables in parallel with old, (2) start dual-writing, (3) migrate readers one consumer at a time, (4) backfill, (5) cut over, (6) drop old.

## 5. Prerequisites for detailed planning (tomorrow)

Before this can become an implementable plan, Melody needs to:

1. Cross-validate the table-shape audit (per her 2026-05-07 message: "tables got changed I don't know I will need to look and cross validate this").
2. Decide on the 4 architectural questions in §3.
3. Confirm whether this is a single-commit refactor or a staged rollout (dual-write phase, etc.).

After her decisions, the detailed plan can be written, advisor-validated, and implemented.

## 6. References

- Tonight's partial cleanup: `docs/review-queue/PLAN_falsy-temp-and-users-location-cleanup-2026-05-07.md` (Phase 2 deletes the obviously-dead /resolve user-row writes; this queued plan covers the rest).
- Schema doctrine being corrected: `shared/schema.js:4-18`.
- CLAUDE.md `Rule 12` "Session-Start Review Protocol" — references `users` session model; will need an update when this refactor lands.
- Audit chain context: `claude_memory` rows 318-323+ (cross-user / device_id / ownership / falsy-coord / lint-gap series).
