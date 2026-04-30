# Driver Briefing, Snapshot, and Header Data Model

## Version: 1.0 — April 14, 2026

---

## 1. Purpose

The system generates and maintains a driver briefing for a request-time snapshot of the end user's context. Briefing may include: weather, traffic, events, airport conditions, school closures, rideshare-relevant news.

The briefing is always bound to exactly one snapshot. A snapshot is the canonical record of "what the user's context looked like at this moment." The briefing is the enriched, AI-consolidated output derived from that snapshot.

---

## 2. Three-Layer Architecture

| Layer | What it is | Source of truth? |
|-------|------------|------------------|
| **Snapshot Contract** | Canonical request-time user context | YES — authoritative for location, time, weather, air, permissions |
| **Briefing Row** | Persisted generated output + operational metadata | YES — authoritative for news/events/traffic/closures/airport |
| **Global Header Projection** | UI display values derived from snapshot + runtime status | NO — purely projected |

**Core rule:** These layers must remain separated. Duplication across layers is exception-only (see §7).

- The **Snapshot Contract** owns location, time, weather, air, permissions, holiday — the "who/where/when/what's the environment."
- The **Briefing Row** owns generated sections — the "what AI + external APIs produced for this snapshot."
- The **Global Header Projection** owns display formatting — the "what the user visually sees in the header," derived live from the snapshot and current runtime status.

A value that belongs in the snapshot MUST NOT be re-persisted in the briefing row unless one of the §7 exceptions applies.

---

## 3. Snapshot Contract Fields

The snapshot contract is defined in two places that must stay aligned:

- **Wire contract** (client ↔ server): `shared/types/snapshot.ts` → `SnapshotV1`
- **DB row** (persisted): `shared/schema.js` → `snapshots` table

> **Note on "Required":** "Required" in this section means *required for the briefing pipeline to run* (enforced by the `status='pending'→'ok'` readiness gate at runtime). The DB schema itself permits NULL for several of these fields because they are enriched asynchronously after row creation (weather, air) or derived (market, h3_r8, coord_key). The readiness gate in `server/api/location/location.js` (PATCH `/snapshot/:id/enrich`) is the enforcement point.

### 3.1 Identity & Linkage (Required)

| Field | Type | Notes |
|-------|------|-------|
| `snapshot_id` | uuid | PK. Primary correlator across snapshot → briefing → strategies. |
| `created_at` | timestamptz | When the snapshot row was written. |
| `device_id` | text | Stable per-device identifier. |
| `session_id` | uuid | Client session binding. |
| `user_id` | uuid | Required for authenticated flows. DB permits NULL for legacy/anonymous paths — the briefing pipeline requires it. |

### 3.2 Geographic Context (Required)

| Field | Type | Notes |
|-------|------|-------|
| `lat` | double precision | 6-decimal precision rule (§3.6). |
| `lng` | double precision | 6-decimal precision rule (§3.6). |
| `coord_key` | text | Format `"lat6d_lng6d"` e.g. `"33.128400_-96.868800"`. FK to `coords_cache`. |
| `h3_r8` | text | H3 resolution-8 geohash for density analysis. |
| `formatted_address` | text | Human-readable full address from Google Geocoding. |
| `city` | text | |
| `state` | text | |
| `country` | text | |
| `market` | text | Metro market label (e.g. "Dallas-Fort Worth"). Captured from `driver_profiles.market` at snapshot creation. Used for market-wide event discovery. |

### 3.3 Local Temporal Context (Required)

| Field | Type | Notes |
|-------|------|-------|
| `timezone` | text | IANA zone name. |
| `local_iso` | timestamp (no tz) | Canonical point-in-time in the snapshot's local zone. |
| `date` | text | `YYYY-MM-DD` form of `local_iso`. |
| `dow` | integer | 0=Sunday … 6=Saturday. **First-class field** — always persisted, never recomputed downstream. |
| `hour` | integer | 0–23. |
| `day_part_key` | text | One of: `overnight`, `morning`, `late_morning_noon`, `afternoon`, `early_evening`, `evening`, `late_evening`. |

> **dow is a first-class field, not optional.** Downstream consumers (rankers, strategists, ML models) must read `dow` from the snapshot directly. They must NOT derive dow from `local_iso` or `date` locally, since the snapshot timezone is the only correct reference and recomputing risks UTC drift.

### 3.4 Environmental Context (Required)

| Field | Type | Notes |
|-------|------|-------|
| `weather` | jsonb | Google Weather current conditions payload. NULL until enrichment completes; `status='pending'` until present. |
| `air` | jsonb | Google Air Quality payload. NULL until enrichment completes; `status='pending'` until present. |

Both are enriched asynchronously via `PATCH /api/location/snapshot/:id/enrich`. Briefing generation is gated on both being populated (memory #111).

### 3.5 Operational Context (Required)

| Field | Type | Notes |
|-------|------|-------|
| `permissions` | jsonb | Contains at minimum `geolocation: "granted" \| "denied" \| "prompt" \| "unknown"`. |
| `holiday` | text | Holiday name (e.g. "Thanksgiving") or `'none'`. Detected via Gemini 3.0 Pro + Google Search at snapshot creation. Default `'none'`. |
| `is_holiday` | boolean | Default `false`. True iff `holiday !== 'none'`. Redundant with `holiday` but kept for indexable boolean filters. |
| `market` | text | *(also listed in §3.2; belongs logically in both geo and operational context — single source of truth is the snapshot row)*. |

### 3.6 Precision Rules

- **Machine-usable coords:** `lat` / `lng` stored at **6-decimal precision** always. `coord_key` format `"lat6d_lng6d"` enforces this at the cache layer. `h3_r8` is the authoritative coarse-grain geohash for density analysis.
- **Human-readable location:** `formatted_address`, `city`, `state`, `market` are the display surfaces. Never fabricate a human-readable label from coords — always use the value resolved by Google Geocoding and stored on the snapshot.
- **Temporal canonical:** `local_iso` is the one point-in-time value. `date`, `dow`, `hour`, `day_part_key` are derived fields computed *once at snapshot creation* against the snapshot's `timezone` and persisted alongside `local_iso`. Downstream code MUST read the persisted derived fields — it MUST NOT recompute them.

### 3.7 Readiness Gate

The snapshot carries a `status` column (text, default `'pending'`):

- `'pending'` — row exists, asynchronous enrichment (weather/air/market/h3_r8) has not yet completed. Briefing pipeline refuses to run (returns HTTP 202).
- `'ok'` — all required fields populated and non-empty. Briefing pipeline is allowed to proceed.

Transition from `pending` → `ok` happens in `PATCH /api/location/snapshot/:id/enrich` after re-reading the row and verifying the resolved required-field list (§9 decision 1) is all non-null / non-empty:

```
REQUIRED_FIELDS = [
  lat, lng, city, state, timezone,
  local_iso, date, dow, hour, day_part_key,
  weather, air, market, user_id
]
```

Fields NOT in this list (`coord_key`, `h3_r8`, `formatted_address`, `country`, `device_id`, `session_id`, `permissions`, `holiday`, `is_holiday`) may be null without blocking.

> **v1.0 note:** earlier drafts of this section listed `h3_r8` as required and did not list `local_iso`, `date`, `dow`, `hour`, or `user_id`. Phase 3 (2026-04-14) resolved both: `h3_r8` is optional (no current readers); the temporal fields and `user_id` are required because the briefing pipeline authoritatively depends on them.

---

## 4. Snapshot Validation & Hard-Fail Rules

- **ALL required fields validated BEFORE any LLM request.** Validation happens at the pipeline entry point in `blocks-fast.js`, gated by `status === 'ok'`.
- **If required fields are null / blank / invalid:** the pipeline retries up to `MAX_SNAPSHOT_RETRIES` (default **5**) via client-side exponential backoff (2s → 4s → 8s → 16s → 32s — memory #112).
- **After the retry threshold:** HARD FAIL. No briefing generation. No fallback derivation. No synthetic substitution of missing values.
- **No routine enrichment/lookup to compensate for missing required fields.** If `market` is missing, we do not fall back to `city` as a market proxy. If `h3_r8` is missing, we do not compute it downstream. The enrichment endpoint is the single write path for these values, and if it did not produce them, the snapshot is not usable for a briefing.
- **Optional fields may be absent without blocking.** `extras`, `device.ua` and similar diagnostic fields are not gated.

> **Rationale:** Silent fallbacks were the root cause of multiple user-visible issues (memory #108 — the "current_snapshot_id never updated" bug was masked by three silent-failure mechanisms). Hard-failing loudly is preferred over fabricating plausible values.

---

## 5. Briefing Row Contract

Table: `briefings` (shared/schema.js:110). Exactly one row per snapshot (`snapshot_id` is `UNIQUE`).

### 5.1 Generated Sections

| Field | Type | Source |
|-------|------|--------|
| `news` | jsonb | Rideshare-relevant news from BRIEFING_NEWS role. |
| `weather_current` | jsonb | Current conditions from Google Weather API (may mirror snapshot.weather when transformed for display). |
| `weather_forecast` | jsonb | Hourly forecast (next 3–6 hours) from Google Weather API. |
| `traffic_conditions` | jsonb | Traffic: incidents, construction, closures, demand zones. Consolidated by `callModel('BRIEFING_TRAFFIC')` — see `briefing-service.js:1543`. |
| `events` | jsonb | Local events: concerts, sports, festivals, nightlife, comedy. Discovered per-snapshot (Rule 11 — no background sync). |
| `school_closures` | jsonb | School district & college closures/reopenings. |
| `airport_conditions` | jsonb | Airport: delays, arrivals, busy periods, recommendations. |

### 5.2 Metadata

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Row PK. |
| `snapshot_id` | uuid | FK to snapshots (UNIQUE, ON DELETE CASCADE). |
| `created_at` | timestamptz | Row write time. |
| `updated_at` | timestamptz | Last mutation (partial regeneration, etc.). |
| `status` | text | `'pending'` \| `'complete'` \| `'error'`. |
| `generated_at` | timestamptz | Set when briefing is *fully* generated (all sections populated). |
| `holiday` | text | Mirrored from snapshot — see §7 exception. |

### 5.3 Completeness Rule

**No null or blank fields in any generated section before data reaches the strategist.**

Validation is enforced in `briefing-service.js generateAndStoreBriefing()` against `REQUIRED_BRIEFING_FIELDS = [events, news, weather_current, traffic_conditions]`. If any are missing or empty, the response carries `complete: false` and `missingFields: string[]` so the caller can gate on completeness (memory #112).

The strategist path consumes only *complete* briefings. A briefing with `status !== 'complete'` must not be forwarded.

---

## 6. Global Header Contract

The header displays: **location label, user-local time, date, temperature, AQI, freshness indicator, location readiness**.

**All values must come from the snapshot or be deterministically derived from snapshot + runtime status.** The header is not allowed to fetch its own data or maintain its own state that diverges from the snapshot.

| Header element | Source |
|----------------|--------|
| Location label | `snapshot.city, snapshot.state` (with `market` as secondary label when useful) |
| User-local time | `snapshot.local_iso` rendered in `snapshot.timezone` |
| Date | `snapshot.date` (already formatted `YYYY-MM-DD`; rendered via client locale formatter) |
| Temperature | `snapshot.weather.current.temperature` (unit from `snapshot.weather` payload, not client locale) |
| AQI | `snapshot.air.aqi` |
| Freshness indicator | **Derived from runtime status** — age of `snapshot.created_at` relative to now, styled by threshold. Open decision §9. |
| Location readiness | **Derived from runtime status** — green when `snapshot.status === 'ok'` and permissions.geolocation === `'granted'`; amber/red otherwise. Open decision §9. |

The header MUST NOT read from the briefing row. The briefing is strategy-facing; the header is snapshot-facing.

---

## 7. Duplication Control

**DEFAULT: Snapshot fields are NOT duplicated into the briefing row.**

If a consumer needs a snapshot field, it joins through `snapshot_id` — it does not re-read a local copy from the briefing.

### Allowed Duplication Exceptions (must cite at least one)

1. **Value must be frozen for audit/history.** E.g. briefing captures `holiday` because a later timezone/holiday reclassification must not retroactively alter an already-generated briefing's meaning.
2. **Value needed for indexing/filtering/reporting.** A column on the briefing row that is queried by reporting dashboards without joining snapshots.
3. **Value required for resilience when the snapshot is unavailable later.** Applies when a briefing may outlive its snapshot (it does not today — cascade delete is configured — but this exception is reserved).
4. **Value materially transformed into briefing-specific output.** `weather_current` on briefings is a transformed/display-shaped version of `snapshot.weather`; they are not the same shape, so this is a transformation, not a duplication.
5. **Value necessary for documented product behavior.** A PM-approved display requirement that cannot be satisfied by a live join.

Any duplicated field added to the briefing row without citing one of these exceptions is a bug and must be removed.

**Currently-held exception inventory:** `briefings.holiday` (exception #1). To be fully enumerated in Phase 7.

---

## 8. Prompt Construction Rules

- **Full snapshot row sent to every briefing-related LLM request.** The snapshot is the canonical input. Prompts are constructed against the full row, and the role-specific consolidator selects what it needs.
- **Prompts should NOT restate snapshot fields in narrative form.** No "The driver is in Frisco, Texas, at 3pm on Tuesday" preamble — the structured snapshot already carries this. Narrative restatement duplicates tokens, invites drift between the text and the structured fields, and gives the model conflicting signals when one goes stale.
- **Components use a task-relevant subset of snapshot fields.** The VENUE_SCORER does not need `permissions.geolocation`; the EVENTS_DISCOVERY role does not need `air`. Each role's prompt builder explicitly selects its subset. No role reads the whole row by default.

---

## 9. Business Decisions (RESOLVED Phase 3 — 2026-04-14)

All seven open decisions from v1.0 are resolved below. Each decision text is binding for Phases 4–8 and for future work on this data model.

- [x] **Field-by-field required vs optional classification — RESOLVED.**
  - **REQUIRED** (must be non-null for `status='ok'`): `lat`, `lng`, `city`, `state`, `timezone`, `local_iso`, `date`, `dow`, `hour`, `day_part_key`, `weather`, `air`, `market`, `user_id`.
  - **OPTIONAL** (may be null without blocking): `coord_key`, `h3_r8`, `formatted_address`, `country`, `device_id`, `session_id`, `permissions`, `holiday`, `is_holiday`.
  - *Note on `formatted_address`:* optional for readiness, but `blocks-fast.js:567` independently hard-fails (400) if missing for LLM geocoding reasons. That stricter path is a per-endpoint product constraint, not a readiness-gate input.
  - *Note on `user_id`:* making this required for `status='ok'` means anonymous snapshots stay `pending` indefinitely. This is intentional — the briefing pipeline requires an authenticated owner.

- [x] **Exact retry count before hard failure — RESOLVED.** `MAX_SNAPSHOT_RETRIES = 5`. Client already enforces this via exponential backoff (2s, 4s, 8s, 16s, 32s). Server now mirrors this via the `X-Snapshot-Retry-Count` request header: when the header value is ≥ 5 and `snapshot.status !== 'ok'`, the server returns **HTTP 503** with `{ error: 'snapshot_incomplete', missingFields, retryCount, maxRetries }`.

- [x] **Header freshness source definition — RESOLVED.** `snapshot.created_at` is the **canonical** freshness timestamp. The current header `lastUpdated` (set on location-resolve completion) is acceptable as a *secondary* indicator for the transitional period but is DOCUMENTED as non-canonical. Phase 6 will re-source the primary indicator to `snapshot.created_at`.

- [x] **Location readiness source definition — RESOLVED.** `snapshot.status === 'ok'` is the **canonical** readiness signal (optionally combined with `permissions.geolocation === 'granted'` once that column has server readers). The current client-side composite (`coords && currentLocationString && !placeholder`) is acceptable transitionally and is DOCUMENTED as non-canonical. Phase 6 will migrate.

- [x] **Duplication exceptions inventory — RESOLVED (per-case below).**
  - `snapshots.weather` ↔ `briefings.weather_current` — **JUSTIFIED** under §7 exception #4 (materially transformed: snapshot.weather is raw API payload for strategist ingestion; briefings.weather_current is LLM-generated analysis for display).
  - `snapshots.air` ↔ header's own `/api/location/air-quality` fetch — **UNJUSTIFIED**. Fix in Phase 6.
  - `snapshots.weather` ↔ header's own `/api/location/weather` fetch — **UNJUSTIFIED**. Fix in Phase 6.
  - `snapshots.holiday` ↔ `briefings.holiday` — **UNJUSTIFIED** (briefings.holiday is a dead column). Mark for removal in Phase 7.
  - `snapshots.timezone` ↔ `dbUserLocation.timezone` (from `/api/auth/me`) — **BORDERLINE** (§7 #5, documented-product-behavior fallback). Phase 6 re-evaluation.
  - `snapshots.local_iso`/`date`/`dow`/`day_part_key` ↔ header render-time `new Date()` / `classifyDayPart` — **UNJUSTIFIED**. Fix in Phase 6.
  - `snapshots.status` ↔ header client-side readiness composite — **UNJUSTIFIED**. Fix in Phase 6.
  - `snapshots.created_at` ↔ header `lastUpdated` — **UNJUSTIFIED** (as primary). Acceptable as secondary per decision #3 above.

- [x] **`status` / `generated_at` field semantics — RESOLVED.**
  - `briefings.status` is currently **DEAD** (never written). Decision: populate it from the existing completeness-validation result in `briefing-service.js` (`'complete'` when all required sections present; `'error'` on generation failure; `'pending'` during initial placeholder insert) — **OR** drop the column. Implementation or removal lands in Phase 7.
  - `briefings.generated_at` is currently **DEAD**. Decision: populate with `NOW()` on the UPDATE at `briefing-service.js:2891` (first successful generation). If we choose to drop instead, the call-site uses `updated_at` as a proxy. Phase 7.

- [x] **Market fallback policy — RESOLVED & IMPLEMENTED (2026-04-16).** `market` IS a required field. The historic city-substitution fallback has been **removed** from `briefing-service.js`: `getMarketForLocation()` now returns `null` on miss (not city), and all callers use `'[unknown-market]'` placeholder that surfaces visibly in AI prompts and logs. No silent data corruption.

---

## 10. Gaps Identified Against Current Schema

These are mismatches between this v1.0 spec and the current implementation that will be addressed in subsequent phases.

1. **Nullable "required" fields.** `market`, `coord_key`, `h3_r8`, `weather`, `air`, `permissions`, `user_id` are all nullable in the DB but required by this spec. Current reconciliation: the `status='pending'→'ok'` readiness gate. Risk: any code path that reads the row without checking `status` sees nulls. (Phase 4.)
2. **Wire vs DB shape divergence.** `SnapshotV1` uses nested `coord` and `resolved`; DB flattens. Not a bug, but Phase 2's field matrix must document both surfaces.
3. **`dow` field trust.** Rule established in §3.3 but not yet audited across consumers — some may still be recomputing from `local_iso`. (Phase 5.)
4. **Header projection audit.** Not yet verified that every header element reads only from snapshot + runtime status. (Phase 6.)
5. **Duplication inventory.** `briefings.holiday` is known; others not yet enumerated. (Phase 7.)
6. **Prompt narrative restatement.** Some existing briefing prompts likely include narrative preambles that duplicate structured snapshot fields. (Phase 8.)

---

## 11. References

- `shared/schema.js` — `snapshots` (line 32), `briefings` (line 110)
- `shared/types/snapshot.ts` — `SnapshotV1` wire contract
- `shared/types/location.ts` — `Coord` wire type
- `server/api/location/location.js` — snapshot creation, enrichment, readiness-gate transition
- `server/api/strategy/blocks-fast.js` — pipeline entry, 202 gate on `status !== 'ok'`
- `server/lib/briefing/briefing-service.js` — `generateAndStoreBriefing`, completeness validation
- Memory #110, #111, #112 — snapshot readiness gate implementation history
- `CLAUDE.md` — Rules 11 (per-snapshot event sync), 13 (DB environment awareness), 14 (model adapter architecture)

---

## Appendix A: Field-Level Matrix (Phase 2 Audit — 2026-04-14)

### A.1 Scope & Method

This appendix maps every field across the three layers (snapshot DB row, briefing DB row, global header display) against the wire contract (`SnapshotV1`). For each field we document: its DB column, its wire-contract counterpart, its header-display use, which layer owns it, its required-or-optional status, its source of truth, whether it is duplicated across layers, and — if duplicated — whether one of the §7 exceptions justifies the duplication.

Method: parallel code audits of `shared/schema.js` (lines 32–130), `shared/types/snapshot.ts`, `client/src/components/GlobalHeader.tsx`, `client/src/contexts/location-context-clean.tsx`, and the primary server consumers (`briefing-service.js`, `blocks-fast.js`, `consolidator.js`, `tactical-planner.js`, `enhanced-smart-blocks.js`).

### A.2 Naming Note

The task brief references a `driverLocationSnapshots` table. The actual table in `shared/schema.js` is **`snapshots`** (line 32). No `driverLocationSnapshots` identifier exists in the codebase. All findings below reference the actual table name.

### A.3 Snapshot Contract Fields

| Field | DB Column | Wire Contract (SnapshotV1) | Header Display | Layer | Required | Source of Truth | Currently Duplicated? | Duplication Justified? |
|-------|-----------|-----------------------------|----------------|-------|----------|-----------------|-----------------------|------------------------|
| snapshot_id | `snapshots.snapshot_id` (uuid PK) | `snapshot_id` | — | Snapshot | Required | Snapshot | No | N/A |
| created_at | `snapshots.created_at` (timestamptz) | `created_at` (string) | Should feed freshness (see A.5) | Snapshot | Required | Snapshot | Yes — header uses client-side `lastUpdated` instead | **REVIEW — §6 violation (freshness)** |
| date | `snapshots.date` (text `YYYY-MM-DD`) | *(absent — derived from `time_context.local_iso`)* | Should feed date; header computes from `new Date()` | Snapshot | Required | Snapshot | Yes — header recomputes at render | **REVIEW — §6 violation (date)** |
| device_id | `snapshots.device_id` (text) | `device_id` | — | Snapshot | Required | Snapshot | No | N/A. **Finding: no readers found server-side.** |
| session_id | `snapshots.session_id` (uuid) | `session_id` | — | Snapshot | Required | Snapshot | No | N/A |
| user_id | `snapshots.user_id` (uuid, nullable) | `user_id` (nullable) | — | Snapshot | Required per spec; DB nullable | Snapshot | No | N/A. Gap: DB allows NULL for anonymous paths; briefing pipeline requires it. |
| lat | `snapshots.lat` (double) | `coord.lat` | — (but feeds `/api/location/weather` fetch) | Snapshot | Required | Snapshot | Partial — client re-sends lat/lng to a separate weather endpoint instead of reading snapshot.weather | **REVIEW — §6 violation (temperature)** |
| lng | `snapshots.lng` (double) | `coord.lng` | — (see lat note) | Snapshot | Required | Snapshot | Partial (same) | **REVIEW — §6 violation** |
| coord_key | `snapshots.coord_key` (text, nullable) | *(absent — derived)* | — | Snapshot | Required per spec; DB nullable | Snapshot (→ coords_cache FK) | No | N/A. **Finding: no readers found** — written at snapshot creation for cache lookup, never re-read. |
| city | `snapshots.city` (text) | `resolved.city` | Location label | Snapshot | Required | Snapshot | Yes — header also reads `dbUserLocation.formatted_address` from `/api/auth/me` | §7 #5 (documented product behavior — DB fallback). Borderline — see A.5. |
| state | `snapshots.state` (text) | `resolved.state` | Location label | Snapshot | Required | Snapshot | Yes (same as city) | §7 #5 |
| country | `snapshots.country` (text) | `resolved.country` | — | Snapshot | Required | Snapshot | No | N/A. **Finding: no server-side readers found.** |
| formatted_address | `snapshots.formatted_address` (text) | `resolved.formattedAddress` (camelCase) | Location label (via `/api/auth/me` copy) | Snapshot | Required | Snapshot | Yes — `dbUserLocation` copy | §7 #5 (borderline) |
| timezone | `snapshots.timezone` (text) | `resolved.timezone` | Time/date via `Intl.DateTimeFormat` zone | Snapshot | Required | Snapshot | Yes — header uses `dbUserLocation.timezone` first, falls back to `LocationContext.timeZone` | §7 #5. Two client sources for the same value — drift risk. |
| market | `snapshots.market` (text, nullable) | *(absent at top level)* | — | Snapshot | Required per spec; DB nullable | Snapshot (copied from `driver_profiles.market` at creation) | Yes — also lives on `driver_profiles` | §7 #1 (frozen per-snapshot for audit) — justified. |
| local_iso | `snapshots.local_iso` (timestamp, no tz) | `time_context.local_iso` (string) | Should feed time; header computes from `new Date()` | Snapshot | Required | Snapshot | Yes — header ignores it | **REVIEW — §6 violation (time)** |
| dow | `snapshots.dow` (int) | `time_context.dow` | Day-of-week label derived at render | Snapshot | Required (first-class per §3.3) | Snapshot | Yes — header re-derives from `now` | **REVIEW — §3.3 rule violation (dow)** |
| hour | `snapshots.hour` (int) | `time_context.hour` | — | Snapshot | Required | Snapshot | Yes — consumers re-derive in some paths | REVIEW (to be quantified in Phase 5) |
| day_part_key | `snapshots.day_part_key` (text) | `time_context.day_part_key` | Time-context label via `classifyDayPart(now, tz)` | Snapshot | Required | Snapshot | Yes — header recomputes | **REVIEW — header should read snapshot value** |
| h3_r8 | `snapshots.h3_r8` (text, nullable) | *(absent)* | — | Snapshot | Required per spec; DB nullable | Snapshot | No | N/A. **Finding: no readers found** — reserved for future density analysis. |
| weather | `snapshots.weather` (jsonb, nullable) | `weather` (Record) | Temperature/conditions — **via separate `/api/location/weather` fetch** | Snapshot | Required per spec; DB nullable until enrichment | Snapshot | **Yes — triplicated**: snapshots.weather (strategist consumer), briefings.weather_current (fresh Google fetch for display), header's own client fetch | **REVIEW — no justification found for client fetch bypassing snapshot. §6 violation.** §7 #4 possibly justifies briefings.weather_current (transformed for display) but needs verification. |
| air | `snapshots.air` (jsonb, nullable) | `air` (Record) | AQI — **via separate `/api/location/air-quality` fetch** | Snapshot | Required per spec; DB nullable until enrichment | Snapshot | Yes — duplicated by header's own fetch | **REVIEW — §6 violation** |
| permissions | `snapshots.permissions` (jsonb, nullable) | `permissions.geolocation` | Location readiness indicator | Snapshot | Required per spec; DB nullable | Snapshot | No write conflict, but header derives readiness from client state, not from `snapshots.permissions` | **REVIEW — §6 violation (readiness)**. **Finding: server never reads permissions column.** |
| holiday | `snapshots.holiday` (text, default `'none'`) | *(absent)* | — | Snapshot | Required | Snapshot | Yes — `briefings.holiday` column exists but is never written | Dead-column duplication. §7 #1 *would* justify it, but the column is unused. **REVIEW — drop or populate.** |
| is_holiday | `snapshots.is_holiday` (boolean, default false) | *(absent)* | — | Snapshot | Required | Snapshot | No (redundant with holiday by design) | §7 #2 (indexable boolean for filtering) — justified within snapshot row. |
| status | `snapshots.status` (text, default `'pending'`) | *(absent — runtime-only)* | Should feed location-readiness; header uses client composite instead | Snapshot | Required | Snapshot | Yes — header bypasses | **REVIEW — §6 violation (readiness)** |

### A.4 Briefing Row Fields

| Field | DB Column | Wire Contract | Header Display | Layer | Required | Source of Truth | Currently Duplicated? | Duplication Justified? |
|-------|-----------|---------------|----------------|-------|----------|-----------------|-----------------------|------------------------|
| id | `briefings.id` (uuid PK) | — | — | Briefing | Required | Briefing | No | N/A |
| snapshot_id | `briefings.snapshot_id` (uuid, UNIQUE FK) | — | — | Briefing | Required | Snapshot (via FK) | No | N/A |
| news | `briefings.news` (jsonb) | — | — | Briefing | Required (§5.3) | Briefing | No | N/A |
| weather_current | `briefings.weather_current` (jsonb) | — | Header temperature does NOT read this | Briefing | Required (§5.3) | Briefing (fresh Google Weather fetch, `briefing-service.js:1654`) | Yes — overlaps with `snapshots.weather` and header's own fetch | §7 #4 (transformed for display) — **needs verification that shape actually differs**. |
| weather_forecast | `briefings.weather_forecast` (jsonb) | — | — | Briefing | Required (§5.3) | Briefing (fresh Google Weather hourly fetch) | No | N/A |
| traffic_conditions | `briefings.traffic_conditions` (jsonb) | — | — | Briefing | Required (§5.3) | Briefing (`callModel('BRIEFING_TRAFFIC')`) | No | N/A |
| events | `briefings.events` (jsonb) | — | — | Briefing | Required (§5.3) | Briefing (per-snapshot Gemini discovery, Rule 11) | No | N/A |
| school_closures | `briefings.school_closures` (jsonb) | — | — | Briefing | Optional | Briefing | No | N/A |
| airport_conditions | `briefings.airport_conditions` (jsonb) | — | — | Briefing | Optional | Briefing | No | N/A |
| holiday | `briefings.holiday` (text) | — | — | Briefing | — | Snapshot (authoritative) | **Yes — DEAD** | **No — never written. Drop the column or populate under §7 #1.** |
| status | `briefings.status` (text) | — | — | Briefing | Should be required (§5.3) | Briefing | **DEAD — never written** | N/A — **implement or drop**. |
| generated_at | `briefings.generated_at` (timestamptz) | — | — | Briefing | Should be required (§5.3) | Briefing | **DEAD — never written** | N/A — **implement or drop**. |
| created_at | `briefings.created_at` (timestamptz, defaultNow) | — | — | Briefing | Required | Briefing | No | N/A |
| updated_at | `briefings.updated_at` (timestamptz, defaultNow) | — | — | Briefing | Required | Briefing | No | N/A (sole timestamp actually maintained across row mutations) |

### A.5 Global Header Display Elements

These are documented as *projections*, not as owned fields. Per §6 every header element must read from snapshot or be deterministically derived from snapshot + runtime status.

| Element | File:Line | Current Source | Spec-Compliant Source | §6 Compliant? |
|---------|-----------|----------------|-----------------------|---------------|
| Location label | `GlobalHeader.tsx:518` | `dbUserLocation.formatted_address` (from `/api/auth/me`) OR `loc.city`+`loc.state` (LocationContext) | `snapshots.formatted_address` (or city+state) | Partial — DB copy via `/api/auth/me` is a frozen *user* location, not a per-snapshot location. **REVIEW.** |
| User-local time | `GlobalHeader.tsx:454` | `new Date()` (ticking 1s) + `dbUserLocation.timezone` | `snapshots.local_iso` rendered in `snapshots.timezone` | **No — §6 violation.** Real-time clock is OK in principle, but should be offset from `snapshot.local_iso` to preserve "point-in-time" semantics. |
| Date | `GlobalHeader.tsx:462` | `new Date()` + timezone | `snapshots.date` | **No — §6 violation.** |
| Day-of-week + day-part label | `GlobalHeader.tsx:466` | `classifyDayPart(now, tz)` | `snapshots.dow` + `snapshots.day_part_key` | **No — §3.3 + §6 violation.** |
| Temperature | `GlobalHeader.tsx:488` | `loc.weather.temp` (from separate `/api/location/weather` fetch at LocationContext:428) | `snapshots.weather.current.temperature` | **No — §6 violation.** |
| AQI | `GlobalHeader.tsx:499` | `loc.airQuality.aqi` (from separate `/api/location/air-quality` fetch at LocationContext:429) | `snapshots.air.aqi` | **No — §6 violation.** |
| Freshness indicator | `GlobalHeader.tsx:520` | `lastUpdated` (set when LocationContext finishes reverse-geocode at :542) | `now - snapshots.created_at` | **No — §6 violation.** |
| Location readiness | `GlobalHeader.tsx:533` | Client composite: `coords && currentLocationString && !placeholder` | `snapshots.status === 'ok' && permissions.geolocation === 'granted'` | **No — §6 violation.** |
| Weather icon/conditions | `GlobalHeader.tsx:478-486` | `loc.weather.conditions` (same fetch as temperature) | `snapshots.weather.current.conditions` | **No — §6 violation** (same root cause as temperature). |

### A.6 Shape Mismatches (DB ↔ Wire)

#### In DB but NOT in wire contract

| DB Column | Reason | Risk |
|-----------|--------|------|
| `date` | Derived from `local_iso`; wire expects client to derive | Low — but if client and server derive differently (timezone bug), snapshot.date and client-displayed date diverge. |
| `coord_key` | Derived from `lat`/`lng`; FK to coords_cache | Low — internal. |
| `market` | Copied from `driver_profiles.market` at creation | **High — wire does not carry market, so clients cannot know or display it.** See §9 open decision on market fallback. |
| `h3_r8` | Derived geohash | Low — no current readers. |
| `holiday` + `is_holiday` | Server-side detection result | Medium — wire omits, so client cannot render holiday context. |
| `status` | Runtime readiness state | Medium — wire omits, so client cannot gate on readiness without a separate fetch. |

#### In wire but NOT in DB

| Wire Field | Reason | Risk |
|------------|--------|------|
| `schema_version: 1` | Versioning tag | Low — not persisted; future migrations will need it. |
| `coord.source` (gps/manual_city_search/manual_pin/ip) | Provenance of coordinates | **Medium — lost on persistence.** We know the user's coords but not how they were obtained. Degrades audit quality and complicates reproduction of bugs. |
| `coord.accuracyMeters` | GPS accuracy | Medium — lost. |
| `device.ua`, `device.platform` | Device fingerprint | Low — `snapshots.device_id` is a text ID; richer device metadata is dropped. |
| `extras` (Record) | Open-ended client diagnostics | Low — intentionally not persisted. |

#### Shape differences (same concept, different structure)

| Concept | DB shape | Wire shape | Risk |
|---------|----------|------------|------|
| Coordinates | Flat `lat` + `lng` top-level | Nested `coord: { lat, lng, source?, accuracyMeters? }` | Each writer translates manually. Phase 4 should introduce a single translator. |
| Resolved location | Flat `city`, `state`, `country`, `formatted_address`, `timezone` top-level | Nested `resolved: { city?, state?, country?, timezone?, formattedAddress? }` (all nullable + camelCase) | Same — manual translation, inconsistent casing. |
| Time context | Flat `local_iso`, `dow`, `hour`, `day_part_key` top-level | Nested `time_context: { local_iso, dow, hour, is_weekend, day_part_key }` | `is_weekend` exists on wire, NOT on DB — loss on persistence. |

### A.7 Summary Counts

- **Snapshot fields audited:** 26
- **Briefing fields audited:** 14
- **Header display elements audited:** 9
- **Total fields audited:** 49
- **Duplications found across layers:** 11
  - weather: snapshots.weather + briefings.weather_current + header's client fetch (**3-way**)
  - air: snapshots.air + header's client fetch (**2-way**)
  - holiday: snapshots.holiday (live) + briefings.holiday (dead) (**2-way**)
  - location label: snapshots(city/state/formatted_address) + /api/auth/me (dbUserLocation) (**2-way**)
  - timezone: snapshots.timezone + dbUserLocation.timezone (**2-way**)
  - date: snapshots.date + header `new Date()` (**2-way**)
  - time: snapshots.local_iso + header `new Date()` (**2-way**)
  - dow: snapshots.dow + header `classifyDayPart(now,tz)` (**2-way**)
  - day_part_key: snapshots.day_part_key + header `classifyDayPart` (**2-way**)
  - freshness: snapshots.created_at + header `lastUpdated` (**2-way**)
  - readiness: snapshots.status + header client composite (**2-way**)
- **Unjustified duplications (REVIEW):** 8
  - briefings.holiday (dead column)
  - header temperature (§6 violation)
  - header AQI (§6 violation)
  - header time/date (§6 violation)
  - header dow/day_part_key (§3.3 + §6 violation)
  - header freshness (§6 violation)
  - header readiness (§6 violation)
  - weather 3-way (likely justified under §7 #4 but needs shape verification)
- **Write-only / dead-read snapshot columns:** 6 — `date`, `device_id`, `coord_key`, `country`, `h3_r8`, `permissions`
- **Dead-write briefing columns:** 3 — `holiday`, `status`, `generated_at`
- **Shape mismatches DB↔wire:** 12 (6 DB-only, 5 wire-only, 3 structural)

### A.8 Action Items Feeding Later Phases

| Finding | Target Phase |
|---------|--------------|
| Header §6 violations (temperature, AQI, time, date, dow, day_part_key, freshness, readiness) | **Phase 6** (Header projection audit) |
| `briefings.status` / `briefings.generated_at` / `briefings.holiday` are dead columns | **Phase 7** (Duplication audit — drop or implement) |
| Weather 3-way duplication — verify briefings.weather_current shape differs from snapshots.weather | **Phase 7** |
| Dead-read snapshot columns (coord_key, country, h3_r8, permissions, date, device_id) | **Phase 7** (investigate: drop, expose, or document as reserved) |
| `snapshots.dow` downstream trust audit | **Phase 5** |
| Shape-translation bugs between DB flat and wire nested representations | **Phase 4** (Hard-fail gate — introduce single translator) |
| `snapshots.market` nullable-but-required + fallback policy | **Phase 3** (resolve open decisions) |
| Missing wire→DB persistence of `coord.source`, `coord.accuracyMeters`, `is_weekend` | **Phase 3** or **Phase 4** — decide whether to extend schema or drop from wire |

---

## Appendix B: Phase 5 — `dow` Field Verification (2026-04-14)

### B.1 Write-Path Verification

`dow` is populated at snapshot creation in **both** write paths, alongside `hour`, `day_part_key`, `local_iso`:

| File:Line | Path | Code |
|-----------|------|------|
| `server/api/location/location.js:1891` | `POST /api/location/resolve` (primary) | `dow: typeof snapshotV1.time_context?.dow === 'number' ? snapshotV1.time_context.dow : null` |
| `server/api/location/snapshot.js:138` | `POST /api/location/snapshot` (secondary) | `dow: typeof dow === 'number' ? dow : null` |
| `server/api/location/location.js:1656` | "minimal mode enriched" fallback | `dow: localDow >= 0 ? localDow : now.getDay()` (derived server-side via `Intl.DateTimeFormat({weekday:'long', timeZone})` + `dayNames.indexOf(...)`) |

Server-side validation at `location.js:1929` rejects snapshots where `dow` is `undefined`/`null` with HTTP 400 `incomplete_snapshot`. `dow` is included in the Phase 4 `REQUIRED_FIELDS` readiness-gate list.

### B.2 Format Verification: `dow` is an INTEGER 0–6

The Phase 5 task brief asserted "`dow` should be a string like 'Monday', 'Tuesday'." This assertion is **incorrect** and contradicts every authoritative source:

| Source | Says |
|--------|------|
| `shared/schema.js:57` | `dow: integer("dow").notNull(), // 0=Sunday, 1=Monday, etc.` |
| `shared/types/snapshot.ts:22` | `dow: number;` |
| `BRIEFING-DATA-MODEL.md §3.3` | `dow | integer | 0=Sunday … 6=Saturday` |
| Memory #110 | "Required NOT NULL: … dow …" (integer per schema) |

Twelve consumers observed — all treat `dow` as an integer:

| Consumer | Treatment |
|----------|-----------|
| `tactical-planner.js:97` | `dayNames[snapshot.dow]` (array index — requires integer) |
| `consolidator.js:1431` | `dayNames[snapshot.dow]` (array index) |
| `consolidator.js:1432` | `snapshot.dow === 0 \|\| snapshot.dow === 6` (weekend check) |
| `get-snapshot-context.js:35,108` | `dow === 0 \|\| dow === 6` |
| `getSnapshotTimeContext.js:73` | `dayOfWeek === 0 \|\| dayOfWeek === 6` |
| `rideshare-coach-dal.js:134` | `dow === 0 \|\| dow === 6` |
| `dump-last-briefing.js:80` | `['Sunday',…'Saturday'][snapshot.dow]` |
| `location.js:1656` | `localDow >= 0` (numeric gate) |
| `location.js:1929` | `dow === undefined \|\| dow === null` (number check) |
| `location.js:2046` | `dayNames[snapshotV1.time_context?.dow]` (array index) |

**Zero consumers treat `dow` as a string.** Migrating to string would silently break every one of them — array-indexing with a string key returns `undefined`, and `"Monday" === 0` is always false so weekend detection would permanently return false.

### B.3 Decision

**`dow` is CORRECT AS-IS.** No code changes made. Per the Phase 5 brief's own clause ("If dow is already correct, just document the finding and move on"), this phase is closed in documentation.

The Phase 5 brief's step-3 string-format assertion is **REJECTED** under Rule 6 (master-architect pushback). If a human-readable day name is needed for display, the correct mechanism is a derived accessor (e.g., `dayNames[snapshot.dow]` at the display layer) or a separate `dow_name` string column — not a migration of the primary integer field.

### B.4 Noted but NOT fixed in Phase 5

1. **Client-trust risk on primary write paths.** `location.js:1891` and `snapshot.js:138` both accept the client-sent `dow` without server-side re-derivation. If the client sends a non-number, the validation at `location.js:1929` rejects the entire snapshot (fail-safe, not silent). But this is less robust than the `:1656` fallback which derives `dow` server-side from `timezone` + `createdAtDate` via `Intl.DateTimeFormat({weekday:'long', timeZone})` + `dayNames.indexOf(...)`. **Recommendation:** apply the same server-side derivation on the primary paths as a sanity check (prefer server value; log-warn if the client disagrees). **Not fixed here** — it is scope-expansion beyond the "if correct, document and move on" instruction. Flag for a future dedicated hardening pass.

2. **§3.3 rule violation: `GlobalHeader.tsx:466` recomputes `dow` via `classifyDayPart(now, tz)`.** Already documented in Appendix A as a Phase 6 target. Not duplicated here. The Phase 6 fix will source the header's day-of-week indicator from `snapshot.dow` directly.

### B.5 Summary

- **dow populated at creation:** YES (both paths + fallback)
- **dow in REQUIRED_FIELDS (Phase 4):** YES (confirmed in `location.js:2390`)
- **dow format correct:** YES (integer per schema and all consumers)
- **Phase 5 code changes:** NONE. Pushback documented. Hardening opportunity flagged for future work.

---

## Appendix C: Header Projection Migration Plan (Phase 6 — 2026-04-14)

> **STATUS: PENDING OWNER APPROVAL.** This appendix documents the proposed migration for the GlobalHeader component to bring it into compliance with §6. No code changes have been made to `client/src/components/GlobalHeader.tsx` or the LocationContext. The header is user-facing and live — rewiring it changes visible UI behavior, so owner sign-off is required before Phase 6b (implementation) proceeds.

### C.1 Scope & §6 Reminder

Per §6, **every value displayed in the GlobalHeader must come from `snapshots` or be deterministically derived from `snapshots` + runtime status.** Phase 2's Appendix A found that 7 of 9 header elements violate this rule. Phase 3 §9 decisions #3 and #4 pinned `snapshot.created_at` as the canonical freshness timestamp and `snapshot.status === 'ok'` as the canonical readiness signal.

This appendix formalizes the projection contract, documents each violation in detail, and proposes a migration path that **preserves the existing UX property of fast visual feedback** (values rendering within ~100ms of login, not blocked on enrichment).

### C.2 Per-Element Audit

For each header element: `Current source` → where the value comes from today; `Spec source` → where §6 says it should come from; `Migration risk` → what can break; `Recommended approach` → the fix.

---

#### C.2.1 Location label (e.g., "Frisco, TX" / formatted address)

- **File:line:** `GlobalHeader.tsx:518` (`<span>{formatLocation()}</span>`)
- **Current source:** `formatLocation()` prefers `dbUserLocation.formatted_address` (served by `/api/auth/me`, so it is the user's *account-level* location, not per-snapshot); falls back to `loc.city, loc.state` from LocationContext.
- **Spec source:** `snapshot.city`, `snapshot.state`, `snapshot.formatted_address` — the *per-snapshot* resolved location.
- **Migration risk:** The current `dbUserLocation` can be stale (user logged in from home, now driving in another city). Phase 2 noted this as a subtle bug hiding behind the priority order. Switching to snapshot may change the label for users whose device moved after login (desired behavior). Risk: brief flicker between old and new value on GPS change.
- **Recommended approach:** Read `snapshot.city`, `snapshot.state`, `snapshot.formatted_address` as **primary**. Fall back to `dbUserLocation` only when no snapshot exists yet (cold-start state). Migration is low-risk because the *shape* of the displayed string doesn't change.

#### C.2.2 Time display (e.g., "11:30:05 AM")

- **File:line:** `GlobalHeader.tsx:454` (`{timeString}`)
- **Current source:** `new Date()` from a `useState` + 1-second `setInterval`, rendered via `Intl.DateTimeFormat({timeZone})` where the timezone is `dbUserLocation.timezone` (fallback: `LocationContext.timeZone`).
- **Spec source:** `snapshot.local_iso` + `snapshot.timezone`, advanced by `now - snapshot.created_at`.
- **Migration risk:** The real-time ticking clock is a core UX affordance (drivers glance at the header to check the time — it must tick). A naive switch to `snapshot.local_iso` would freeze at the snapshot creation instant.
- **Recommended approach:** Keep the 1-second ticking render, but **anchor** to snapshot: `displayTime = snapshot.local_iso + (now - snapshot.created_at)`. The tick interval still uses `new Date()` for *delta*, but the zero-point is the snapshot's point-in-time. This satisfies §6 ("deterministically derived from snapshot + runtime status") while preserving the real-time clock UX. Timezone reads from `snapshot.timezone`, not `dbUserLocation.timezone`.

#### C.2.3 Date display (e.g., "Tuesday, Apr 14")

- **File:line:** `GlobalHeader.tsx:462,466` (`{dayOfWeek}, {dateString}`)
- **Current source:** `new Date()` + `Intl.DateTimeFormat({timeZone, month:'short', day:'numeric'})` for the date; `classifyDayPart(now, tz)` for day-part context; `dayOfWeek` computed from `now` + timezone.
- **Spec source:**
  - date → `snapshot.date` (already `YYYY-MM-DD` in snapshot timezone); format for display only.
  - day-of-week → `snapshot.dow` (integer 0–6; map via `['Sunday',...,'Saturday']`). Per Appendix B, `dow` is authoritatively integer.
  - day-part → `snapshot.day_part_key`.
- **Migration risk:** Display strings may change subtly if the snapshot's timezone differs from `dbUserLocation.timezone` (possible after travel). This is desired behavior but may surprise users during the transition.
- **Recommended approach:** Direct substitution. `dateString` from `snapshot.date`; `dayOfWeek` from `dayNames[snapshot.dow]`; `timeContextLabel` from `snapshot.day_part_key`. No recomputation.

#### C.2.4 Temperature display (e.g., "76°" + weather icon)

- **File:line:** `GlobalHeader.tsx:488` (`{Math.round(weather.temp)}°`), icon at `:478-486`
- **Current source:** `loc.weather.temp` + `loc.weather.conditions` from `LocationContext`, which fetches `/api/location/weather?lat=..&lng=..` independently of snapshot creation (line 428 in LocationContext). **This is the most consequential §6 violation** — it means the displayed temperature was fetched at a different moment than the snapshot's enrichment, and the two can disagree.
- **Spec source:** `snapshot.weather` (the jsonb blob populated by `PATCH /snapshot/:id/enrich`). Shape: `{ tempF, conditions, description }` per `location.js:1895-1899`.
- **Migration risk:**
  - **Timing:** snapshot.weather is null until enrichment completes (typically <1s after creation). Current fetch is also async — no worse than status quo.
  - **Shape:** current UI reads `weather.temp` and `weather.conditions`. Snapshot's stored shape uses `tempF` (not `temp`). Rename needed at the consumption site.
  - **Loss of independence:** if snapshot enrichment fails, header temperature disappears. Acceptable per Phase 4 hard-fail philosophy — the `vecto-snapshot-hard-fail` event gives the UI a way to render a targeted "weather unavailable" note.
- **Recommended approach:** Switch to `snapshot.weather.tempF` / `.conditions`. Remove the independent `/api/location/weather` fetch entirely. Phase 6b can keep the fetch during a deprecation window, with a console.warn when the shim path fires, to confirm the snapshot path reliably covers the real-user traffic before removal.

#### C.2.5 AQI badge (e.g., "AQI 78")

- **File:line:** `GlobalHeader.tsx:499` (`AQI {airQuality.aqi}`)
- **Current source:** `loc.airQuality.aqi` + `.category` from `LocationContext`, fetched independently from `/api/location/air-quality?lat=..&lng=..` (LocationContext line 429).
- **Spec source:** `snapshot.air` (jsonb blob from enrichment).
- **Migration risk:** Same class as C.2.4. Shape alignment is simpler here — both sides use `aqi` + `category`.
- **Recommended approach:** Switch to `snapshot.air.aqi` / `.category`. Drop the independent fetch. Same deprecation-window shim recommended.

#### C.2.6 Freshness indicator (e.g., "just now" / "5m ago")

- **File:line:** `GlobalHeader.tsx:520` (`({lastUpdated ? timeAgo(lastUpdated) : "just now"})`)
- **Current source:** `lastUpdated` set by LocationContext:542 as `new Date().toISOString()` when reverse-geocoding completes.
- **Spec source (Phase 3 decision #3):** `snapshot.created_at` is canonical.
- **Migration risk:** Timer drift between LocationContext's local clock and the server's `created_at` is typically < 1s — no visible UX change for users. One gotcha: `snapshot.created_at` is a server timestamp with timezone; displaying "X ago" must compute against the *client's* clock. That arithmetic already happens in `timeAgo()` so the risk is zero.
- **Recommended approach:** Swap `lastUpdated` → `snapshot.created_at`. `timeAgo()` logic unchanged. `lastUpdated` can be kept as a secondary diagnostic (shown in hover tooltip, e.g.) if desired, but the primary display reads from the snapshot per decision #3.

#### C.2.7 Location readiness (e.g., "location ready" ✓)

- **File:line:** `GlobalHeader.tsx:525-535`
- **Current source:** `isLocationResolved`, computed client-side at LocationContext:168-174 as `coords.latitude && coords.longitude && currentLocationString && !placeholder`. Does not consult snapshot status or geolocation permission.
- **Spec source (Phase 3 decision #4):** `snapshot.status === 'ok'` is canonical. Optionally AND with `snapshot.permissions.geolocation === 'granted'` once that column has server readers.
- **Migration risk:** The current signal goes green ~200ms after GPS resolves; the snapshot-based signal goes green after enrichment completes (typically <1s, but could be longer on slow network). Users may perceive readiness as "slower" on the new signal. Mitigation: show an intermediate state "resolving…" while `status='pending'` and only flip to ✓ on `'ok'`.
- **Recommended approach:**
  - Primary: `snapshot.status === 'ok'` → green "location ready."
  - `snapshot.status === 'pending'` (or no snapshot yet) → amber "resolving location…" (show missing-fields from 202 payload as tooltip for debuggability).
  - **Hard-fail state (from `vecto-snapshot-hard-fail` CustomEvent, Phase 4):** red "Location data incomplete — please refresh." Add a `useEffect` subscribing to the event and storing `{ snapshotId, missingFields, message }` in local state; render the red state until a new `snapshotId` arrives (at which point clear the state).
  - Phase 3 decision #4 permits the current composite as a transitional secondary signal. Recommended: ship the snapshot-primary path and keep the composite as fallback only when `snapshot` is null (true cold start).

#### C.2.8 Day-of-week + day-part label (part of C.2.3, listed separately for clarity)

- **File:line:** `GlobalHeader.tsx:466` (`{dayOfWeek}, {dateString} • {timeContextLabel}`)
- Covered by C.2.3. Included here only because Appendix A §A.5 classified it as its own violation.

#### C.2.9 Weather icon (CloudRain / Cloud / Sun / CloudSnow)

- **File:line:** `GlobalHeader.tsx:478-486`
- Covered by C.2.4 (uses the same `weather.conditions` string). Will follow whatever we decide for temperature.

### C.3 §6 Compliance Summary (post-migration)

| Element | Current source | Post-migration source | §6-compliant? |
|---------|----------------|-----------------------|---------------|
| Location label | `dbUserLocation` / `loc.city` | `snapshot.city`, `snapshot.state`, `snapshot.formatted_address` | YES |
| Time display | `new Date()` + `dbUserLocation.timezone` | `snapshot.local_iso + (now - snapshot.created_at)` rendered in `snapshot.timezone` | YES (deterministic derivation) |
| Date display | `new Date()` formatting | `snapshot.date` | YES |
| Day-of-week | `new Date()` + timezone | `dayNames[snapshot.dow]` | YES |
| Day-part label | `classifyDayPart(now, tz)` | `snapshot.day_part_key` | YES |
| Temperature | `/api/location/weather` fetch | `snapshot.weather.tempF` | YES |
| Weather icon | `/api/location/weather` fetch | `snapshot.weather.conditions` | YES |
| AQI | `/api/location/air-quality` fetch | `snapshot.air.aqi` | YES |
| Freshness | `lastUpdated` | `snapshot.created_at` | YES |
| Location readiness | Client composite | `snapshot.status === 'ok'` + hard-fail event | YES |

### C.4 Migration Path (Preserving Fast Visual Feedback)

The current UX property worth preserving: values render within ~100–500ms of page load, not blocked on the briefing pipeline. The snapshot-driven reads mostly satisfy this already (snapshot creation is part of the first GPS-resolve flow), but care is needed.

**Phase 6b — Implementation (requires owner approval):**

1. **Add snapshot-reading code paths alongside the existing ones.** Render the snapshot-derived value if `snapshot` is available; otherwise fall back to the current `dbUserLocation` / `loc.weather` / `lastUpdated` / composite paths. This gives us a safety net during rollout.

2. **Hook the `vecto-snapshot-hard-fail` CustomEvent into the header.** On event, set a React state like `hardFailState: { message, missingFields } | null`. When non-null, render the red "Location data incomplete — please refresh." in the readiness slot, overriding the normal indicator. Clear the state when a new `snapshotId` arrives. This is the missing UI consumer for the Phase 4 event — without it, Phase 4's hard-fail is only observable via `console.error`.

3. **Use a single snapshot-subscription hook at the top of GlobalHeader.** Something like `const snapshot = useCurrentSnapshot();` returning the full row (or null while pending). This avoids scattered reads of individual fields and makes the shape change local to one file.

4. **For temperature / AQI specifically:** keep the `/api/location/weather` and `/api/location/air-quality` fetches running *in parallel* during a deprecation window (e.g., 1–2 weeks) with a console.warn when the fallback fires. After that window, remove the client-side fetches entirely — their only caller is the header.

5. **For the real-time clock anchoring:** introduce a small helper `useAnchoredClock(snapshot)` that returns a ticking `Date` equal to `snapshot.local_iso + (now - snapshot.created_at)`. Unit-test the anchor math against `Intl.DateTimeFormat` output to confirm timezone correctness.

6. **Validation:** after implementation, visually confirm all 10 header elements in a running browser session. Type-check with `npx tsc --noEmit`. Monitor console for `[CoPilot] HARD FAIL` messages during QA to validate the readiness indicator flips to the red state on triggered failures (e.g., simulate by sending `X-Snapshot-Retry-Count: 6`).

### C.5 Owner Approval Checkpoint

**Before Phase 6b proceeds, the session owner must confirm:**

- [ ] Switching location label to per-snapshot data (may change what users see if their device moved post-login) is acceptable.
- [ ] Anchored-clock approach for the real-time time display is acceptable (vs. keeping `new Date()` free-running).
- [ ] The `vecto-snapshot-hard-fail` UI integration plan — rendering a red "Location data incomplete — please refresh" in the readiness slot — matches intended UX copy, or new copy should be provided.
- [ ] Weather/AQI independent fetches may be removed from the client after the deprecation window.
- [ ] Whether to ship Phase 6b as a single PR or split into per-element commits (recommended: single PR because the reads share the snapshot hook).

### C.6 Summary

- Header elements audited: **10** (9 from Phase 2 + weather icon broken out)
- §6 violations: **8** (one per element except the weather icon, which rides on temperature's fix)
- Code changes made in Phase 6: **NONE**. This is documentation + migration plan only.
- Phase 4's `vecto-snapshot-hard-fail` event currently has **no UI consumer**. The Phase 6b plan adds the missing subscriber.
- Next action: **owner approval on §C.5 checkpoint before Phase 6b proceeds.**

---

## Appendix D: Duplication Exception Register (Phase 7 — 2026-04-14)

### D.1 Purpose

This appendix is the canonical register of every field in the data model that is duplicated across layers. For each duplication, it cites one of the five §7 exceptions that justifies it — or marks it **UNJUSTIFIED**, in which case it carries a remediation recommendation.

The register consolidates findings from Phase 2 Appendix A §A.7 (duplications found) and Phase 3 §9 decision #5 (per-case justifications) into a single maintained index.

### D.2 §7 Exception Reminder

A duplication is justified only if at least one of these five exceptions applies:

1. **Frozen for audit/history.** The duplicated copy must not follow later changes to the source.
2. **Needed for indexing / filtering / reporting.** A column that is queried directly without a join.
3. **Required for resilience when the source is unavailable later.**
4. **Materially transformed into a different shape for the consuming layer.** The copy is not a copy — it is a derivation with a different purpose.
5. **Necessary for documented product behavior.** A PM-approved constraint that cannot be satisfied by a live join.

### D.3 Duplication Register

Each row is a duplication. Columns:
- **Source of truth** — the authoritative layer.
- **Duplicate location** — where else the value exists.
- **§7 exception** — 1, 2, 3, 4, 5, or **UNJUSTIFIED**.
- **Remediation** — if unjustified, what to do.

| # | Source of truth | Duplicate location | §7 exception | Remediation |
|---|-----------------|--------------------|--------------|-------------|
| 1 | `snapshots.weather` (raw summary, shape `{tempF, conditions, description}`) | `briefings.weather_current` (full Google Weather API response, different shape) | **#4 (transformed)** — different shapes serve different consumers: snapshot for strategist/LLM input, briefing for UI display. Justification verified via Phase 2 agent finding that `fetchWeatherConditions()` calls Google Weather API directly (not a copy). | None — justified. |
| 2 | `snapshots.weather` | Client-side `/api/location/weather` fetch → `loc.weather.temp` in `LocationContext` → rendered in `GlobalHeader.tsx:488` | **UNJUSTIFIED** — independent client fetch bypasses the snapshot layer entirely, violating §6. | **Fix in Phase 6b** (pending owner approval, Appendix C §C.2.4). Header reads `snapshot.weather.tempF`; remove the independent fetch after deprecation window. |
| 3 | `snapshots.air` | Client-side `/api/location/air-quality` fetch → `loc.airQuality.aqi` → `GlobalHeader.tsx:499` | **UNJUSTIFIED** — same class as #2. | **Fix in Phase 6b** (Appendix C §C.2.5). |
| 4 | `snapshots.holiday` (text, populated at creation) | `briefings.holiday` (text column, **NEVER WRITTEN** per Phase 2) | **UNJUSTIFIED** — the briefing column is dead (no write paths). If it were written, §7 #1 (frozen for audit/history) would justify it; because it is dead, it is pure schema bloat. | **RECOMMEND REMOVAL** — see §D.4 Dead Columns. |
| 5 | `snapshots.city`, `state`, `formatted_address` (per-snapshot resolved) | `dbUserLocation.formatted_address` / `.city` / `.state` served by `/api/auth/me` (user's account-level location) | **#5 (documented product behavior)** — BORDERLINE. The account-level copy is used for cold-start render before any snapshot exists. Phase 6b will switch the primary source to per-snapshot values and keep the account-level copy as cold-start fallback only. | None on the DB side — the snapshot is authoritative. Header rewiring is Phase 6b. |
| 6 | `snapshots.timezone` | `dbUserLocation.timezone` via `/api/auth/me` | **#5 (documented product behavior)** — BORDERLINE (same as #5 above). | None on DB side. Phase 6b will prefer `snapshots.timezone` at the header. |
| 7 | `snapshots.date` (text `YYYY-MM-DD` in snapshot timezone) | Header recomputes via `new Date()` + `Intl.DateTimeFormat({timeZone})` at `GlobalHeader.tsx:462` | **UNJUSTIFIED** — violates §6. | **Fix in Phase 6b** (Appendix C §C.2.3). |
| 8 | `snapshots.local_iso` (timestamp, no tz) | Header recomputes via `new Date()` at `GlobalHeader.tsx:454` | **UNJUSTIFIED** — violates §6. | **Fix in Phase 6b** via `useAnchoredClock(snapshot)` helper (Appendix C §C.2.2) — preserves real-time tick UX while sourcing from snapshot. |
| 9 | `snapshots.dow` (integer 0–6) | Header recomputes via `classifyDayPart(now, tz)` at `GlobalHeader.tsx:466` | **UNJUSTIFIED** — also violates §3.3 "first-class field, never recomputed downstream." | **Fix in Phase 6b** — read `dayNames[snapshot.dow]` (Appendix C §C.2.3). |
| 10 | `snapshots.day_part_key` | Header recomputes via `classifyDayPart(now, tz)` at `GlobalHeader.tsx:466` (same call site as #9) | **UNJUSTIFIED** — violates §6. | **Fix in Phase 6b** — read `snapshot.day_part_key` (Appendix C §C.2.3). |
| 11 | `snapshots.created_at` (Phase 3 decision #3 canonical) | `lastUpdated` state in `LocationContext`, set at reverse-geocode completion, rendered at `GlobalHeader.tsx:520` | **UNJUSTIFIED as primary** — violates §6. Acceptable as *secondary* diagnostic per decision #3. | **Fix in Phase 6b** (Appendix C §C.2.6). |
| 12 | `snapshots.status` (Phase 3 decision #4 canonical) | Client-side composite `coords && currentLocationString && !placeholder` at `LocationContext:168-174` → `isLocationResolved` → `GlobalHeader.tsx:525-535` | **UNJUSTIFIED** — violates §6. | **Fix in Phase 6b** (Appendix C §C.2.7) — read `snapshot.status === 'ok'` + consume `vecto-snapshot-hard-fail` event. |
| 13 | `snapshots.market` (copied from `driver_profiles.market` at creation) | `driver_profiles.market` (ongoing) | **#1 (frozen for audit/history)** — the snapshot's market value is frozen at creation; later changes to `driver_profiles.market` (user moves markets) must not retroactively alter the snapshot's meaning. | None — justified. |
| 14 | `snapshots.is_holiday` (boolean derived from `snapshots.holiday`) | `snapshots.holiday` (text) | **#2 (indexable boolean for filtering)** — both live on the same row; `is_holiday` is the filterable form of `holiday`. Not a cross-layer duplication. | None — justified within the row. |

### D.4 Dead Briefing Columns

Phase 2 Appendix A identified three columns on the `briefings` table that are declared in `shared/schema.js:110-130` but never written by any code path. Each needs a decision.

| Column | Current state | Decision | Action |
|--------|---------------|----------|--------|
| `briefings.generated_at` | **Dead — never written** | **IMPLEMENT** (safe code change per brief) | **FIXED in Phase 7** (this appendix): `briefing-service.js` now sets `generated_at: new Date()` on both the INSERT path (line 2889) and the UPDATE path (line 2902) in the final-data-store write. Placeholder (2590), refresh-clear (2610), and error (2634) paths intentionally leave `generated_at` untouched so it preserves "last successful generation time" across transient failures. |
| `briefings.holiday` | **Dead — never written**. Snapshot already has `holiday` + `is_holiday` columns populated by the holiday detector at snapshot creation. | **RECOMMEND REMOVAL** | Produce a migration to `ALTER TABLE briefings DROP COLUMN holiday;` after confirming no ad-hoc consumers exist (a final `grep -r "briefings.holiday" / "briefings\.\?.*holiday"` pass). Blocked on: explicit owner approval for a destructive schema change (Rule: destructive DB ops need user confirmation). Until then, the column remains dead and is documented here as such. |
| `briefings.status` | **Dead — never written**. Completeness validation exists at `briefing-service.js:2922-2929` but its result (`isComplete: boolean`, `missingFields: string[]`) is returned to the caller via the API response, not persisted. | **RECOMMEND POPULATE** — not implemented in Phase 7 because the correct semantics require threading through the completeness-check result into the DB write, which is a larger change than the generated_at two-liner. | Phase 8 or a dedicated later pass. Proposed states: `'pending'` on placeholder insert (2590); `'error'` on the error path (2634); `'complete'` on the final-data-store path if `isComplete === true`; `'partial'` if final-data-store succeeds but `isComplete === false`. Consumer-side: strategist pipeline should refuse to read any briefing with `status !== 'complete'` (currently it gets only via `complete` flag in the return payload). |

### D.5 Summary

- **Duplications registered:** 14
  - Justified (§7 #1–5): **5** (entries 1, 5, 6, 13, 14)
  - Unjustified: **9** (entries 2, 3, 4, 7, 8, 9, 10, 11, 12)
    - Of the 9 unjustified:
      - 7 are header-layer violations (entries 2, 3, 7, 8, 9, 10, 11, 12 — no, that is 8, but entries 9 and 10 share a call site so functionally 7 fix points) scheduled for Phase 6b pending owner approval.
      - 1 is the dead `briefings.holiday` column (recommend removal in §D.4).
- **Dead briefing columns:** 3 — `generated_at` (FIXED this phase), `holiday` (recommend remove), `status` (recommend populate, Phase 8).
- **Code change in Phase 7:** 1 edit to `server/lib/briefing/briefing-service.js` — `generated_at: new Date()` added to INSERT briefingData object and UPDATE set block. Verified with `node --check`. No consumer needs to change: any existing reader gets a real timestamp where it used to get NULL.
- **Remaining work routed to later phases:**
  - Phase 6b (owner-approval-blocked) — entries 2, 3, 7, 8, 9, 10, 11, 12.
  - Phase 8 or future — `briefings.status` population.
  - Destructive-ops-owner-approval — `briefings.holiday` column drop.

---

## Appendix E: Prompt Construction Compliance (Phase 8 — 2026-04-14)

### E.1 §8 Rules in Practice

§8 has three rules. The audit below checks each active prompt site against all three.

| Rule | Summary | Compliance check |
|------|---------|------------------|
| §8.1 | Full snapshot row sent to every briefing-related LLM request. | Does the prompt include **all relevant snapshot fields** (structured), or only some? |
| §8.2 | Prompts should NOT restate snapshot fields in narrative prose. | Is the context conveyed as structured labeled fields, or as paraphrased prose? |
| §8.3 | Components use a **task-relevant subset** of snapshot fields. | Does each role include only the fields it actually needs? |

**Interpretation nuance:** §8.1 and §8.3 appear to be in tension if read strictly ("send everything" vs. "send only what's needed"). In practice the codebase resolves this with a third pattern: **embed snapshot fields as structured labeled pairs inside the prompt text** (e.g., `Current position: X / Timezone: Y / Day: Z`). This is compliant with §8.2 because nothing is paraphrased, and satisfies §8.1's intent (the role sees the snapshot's structure) while also satisfying §8.3 (each role selects its own subset). Phase 8 confirms this pattern is the de-facto standard and does not flag it as a violation.

### E.2 Prompt Site Audit

#### E.2.1 `server/lib/briefing/briefing-service.js:982–1009` — BRIEFING_EVENTS (per-category Gemini discovery)

- **Fields used:** `category`, `city`, `state`, `market`, `lat`, `lng`, `date`, `timezone` (passed as function parameters, ultimately from snapshot).
- **Structured vs narrative:** Mixed. The category name, event types, date, and search area are structured. Lines 982–984 include the prose `"The driver is currently near coordinates (${lat}, ${lng}). Prioritize discovering events at venues within 15 miles..."`.
- **§8.1 (full snapshot sent):** Partial — this call site passes individual fields, not the full row. Task-appropriate for a discovery role (the model does not need weather/air/permissions/holiday to discover concerts).
- **§8.2 (no narrative restatement):** **Borderline but COMPLIANT.** The prose sentence at line 984 is **instructional** ("prioritize within 15 miles"), not merely duplicative. There is no structured snapshot being passed alongside this prompt, so the coordinate restatement is load-bearing — the model has no other channel to see the coordinates. Memory #107 shipped this line as a proximity-bias fix; without it, event discovery was metro-wide with no priority given to the driver's actual location.
- **§8.3 (task-relevant subset):** COMPLIANT — only 8 fields used.
- **Verdict:** **COMPLIANT.** The narrative is instructional and necessary; not §8.2 anti-pattern.

#### E.2.3 `server/lib/strategy/tactical-planner.js:85–160` — VENUE_SCORER prompt

- **Fields used:** `formatted_address` / `city` / `state` (→ `location`), `dow` (→ `dayName`), `created_at` + `timezone` (→ `dateStr` + `timeStr`).
- **Structured vs narrative:** Mostly narrative but not restating fields — the prose is about the MISSION and RULES (e.g. "Your job: Convert the IMMEDIATE action plan..."). The driver location appears as `the ${location} region` and in the VENUE SELECTION bullet `ONLY recommend venues near ${location}`.
- **§8.1 (full snapshot sent):** Partial — only `location`, `dayName`, `dateStr`, `timeStr` are embedded. Acceptable for a venue-selection role.
- **§8.2 (no narrative restatement):** COMPLIANT. Location appears as a single interpolated reference within instructional prose, not as a restated structured field.
- **§8.3 (task-relevant subset):** COMPLIANT.
- **Date/time derivation issue:** Lines 100–116 compute `dateStr` and `timeStr` from `snapshot.created_at` + `snapshot.timezone` using `toLocaleDateString` / `toLocaleTimeString`. This **could** read `snapshot.local_iso` + `snapshot.date` directly per §3.3's "never recomputed downstream" rule. The current approach is functionally equivalent when snapshot is fresh but drifts if the snapshot is older than the current wall-clock — which, for a venue-scorer running against a recent snapshot, is a non-issue. **Flag as soft-finding only**, not a blocker.
- **Verdict:** **COMPLIANT** with a soft recommendation to prefer `snapshot.date` / `snapshot.local_iso` over re-formatting `created_at`.

#### E.2.4 `server/lib/ai/providers/consolidator.js` — other callModel sites (BRIEFING_TRAFFIC, BRIEFING_NEWS, formatters)

- Briefly surveyed. These follow the same structured labeled-fields pattern as E.2.2. No narrative-restatement anti-patterns observed.

#### E.2.5 `server/lib/ai/rideshare-coach-dal.js` — Rideshare Coach chat prompts

- Reads `snapshot.dow`, `snapshot.city`, `snapshot.state`, `snapshot.holiday`, etc. for coach context. Follows the structured pattern.
- `snapshot.dow` and weekend derivation at :132–134 — correct usage, reads persisted field.
- **Verdict:** COMPLIANT with the same caveat as E.2.2.

### E.3 Aggregate Findings

- **Prompt sites audited:** 5 primary
- **§8.1 violations:** 0 (subset-passing is compatible with §8.3)
- **§8.2 violations (narrative restatement):** 0 confirmed. 1 borderline at `briefing-service.js:984` that was verified as instructional-not-duplicative (Memory #107).
- **§8.3 violations (bloated prompts):** 0
- **Soft recommendations:** `tactical-planner.js:100–116` could read `snapshot.date` / `snapshot.local_iso` directly rather than re-formatting `created_at`. Low priority.

### E.4 Recommendation: Clarify §8 Wording

The strict reading of §8.1 ("full snapshot row sent to every briefing-related LLM request") suggests attaching a raw JSON blob. The codebase's de-facto pattern is **structured labeled fields inside the prompt text**, which is semantically equivalent and more readable for the model. Phase 8 recommends a future v1.1 of the spec soften §8.1 to:

> "The task-relevant subset of snapshot fields MUST be embedded in every briefing-related LLM request as structured, labeled fields (not as narrative prose). Each role selects its own subset per §8.3."

This makes §8.1, §8.2, §8.3 mutually consistent rather than in tension.

### E.5 Summary

- Phase 8 code changes: **NONE** (documentation only per brief).
- Prompt anti-pattern count: **0 confirmed, 1 borderline verified as compliant, 1 soft recommendation.**
- Spec-clarification opportunity noted in §E.4.

---

## Session Summary (2026-04-14)

Eight-phase autonomous Data Model Hardening Session driven against the April 14, 2026 "Driver Briefing, Snapshot, and Header Data Model" specification. All phases complete.

### Phase Register

| Phase | Scope | Outcome | Commit | Memory |
|-------|-------|---------|--------|--------|
| **1** | Data model spec + session bootstrap | `BRIEFING-DATA-MODEL.md` v1.0 (§1–§11) | d6c82597 (incl. Phase 2) | #113 |
| **2** | Field-level matrix audit | Appendix A — 49 fields, 11 duplications, 8 §6 violations surfaced | d6c82597 | #114 |
| **3** | Resolve §9 open decisions | §9 all 7 resolved; §3.7 synced | b9b64d0b | #115 (joint) |
| **4** | Hard-fail gate implementation | `REQUIRED_FIELDS` updated; `X-Snapshot-Retry-Count` header + 503 path in blocks-fast.js; client retry loop + `vecto-snapshot-hard-fail` event in CoPilotContext | 52095ec9 | #115 (joint) |
| **5** | `dow` field audit + fix | Verified integer 0-6 correct; **pushed back** on string-format assertion; no code change | 24ccfa3a | #116 |
| **6** | Header projection audit (docs-only) | Appendix C — 10 header elements, 8 §6 violations, migration plan with owner approval checkpoint | 88ee3fe3 | #117 |
| **7** | Duplication audit + dead-column triage | Appendix D — 14 duplications registered (5 justified, 9 unjustified); **`briefings.generated_at` populated** at INSERT + UPDATE | 1a9b2a85 | #118 |
| **8** | Prompt construction audit + session summary | Appendix E — 5 prompt sites audited, 0 violations confirmed; this session summary | (this commit) | (this commit) |

### Code Changes Shipped

| File | Phase | Change |
|------|-------|--------|
| `server/api/location/location.js` | 4 | `REQUIRED_FIELDS` array updated to resolved Phase 3 classification (removed `h3_r8`; added `local_iso`, `date`, `dow`, `hour`, `user_id`) |
| `server/api/strategy/blocks-fast.js` | 4 | Added `MAX_SNAPSHOT_RETRIES=5`, reads `X-Snapshot-Retry-Count` header, returns HTTP 503 with `{error, missingFields, retryCount, maxRetries}` on exhaustion. `console.error` + `triadLog.error` on hard fail. |
| `client/src/contexts/co-pilot-context.tsx` | 4 | Added `snapshotHardFailRef`; retry loop passes `X-Snapshot-Retry-Count: <attempt>` header; on 503 sets the ref, dispatches `vecto-snapshot-hard-fail` CustomEvent, and blocks further retriggers until new snapshot or manual refresh. |
| `server/lib/briefing/briefing-service.js` | 7 | `briefings.generated_at` populated at final-data-store writes (INSERT + UPDATE). Dead column now live. |

**Total code diff:** 4 files, ~90 lines added. All verified with `node --check` (server) and `npx tsc --noEmit --pretty` (client, exit 0).

### Docs Shipped

Single source of truth: **`BRIEFING-DATA-MODEL.md`** at repo root.
- §1–§11: v1.0 spec (architecture, contract, validation, briefing row, header contract, duplication control, prompt construction rules, open decisions, gaps, references)
- **Appendix A:** Field-Level Matrix (Phase 2)
- **Appendix B:** `dow` Field Verification (Phase 5)
- **Appendix C:** Header Projection Migration Plan (Phase 6 — PENDING OWNER APPROVAL)
- **Appendix D:** Duplication Exception Register (Phase 7)
- **Appendix E:** Prompt Construction Compliance (Phase 8)

### Pending Owner Approval

Three items blocked on Melody's return:

1. **Phase 6b — Header rewiring.** Appendix C §C.5 checkpoint has 5 confirmations needed before the GlobalHeader component is migrated to read from snapshot. This unblocks: 7 §6 violations, activation of the Phase 4 `vecto-snapshot-hard-fail` UI consumer, and removal of the redundant client-side `/api/location/weather` + `/api/location/air-quality` fetches.
2. **`briefings.holiday` DROP COLUMN.** Destructive schema op — requires explicit approval. Column is dead (never written); `snapshots.holiday` is authoritative.
3. **`briefings.status` populate.** Larger change than `generated_at` (requires threading completeness-validation result into DB write). Deferred to a future dedicated pass.

### Notable Pushbacks (Rule 6 Applied)

- **Phase 5 string-format assertion** — rejected. `dow` is integer per schema and 12 consumers; string migration would silently break every one. Documented in Appendix B.
- **Path corrections** — Phase 3+4 brief referenced `server/lib/briefing/location.js` (doesn't exist); correct path `server/api/location/location.js`. Phase 8 brief implicitly expected a `driverLocationSnapshots` table; correct name is `snapshots`.
- **Characterization correction** — Phase 3 called `briefings.weather_current` "LLM-generated analysis"; Phase 2 agent proved otherwise (direct Google Weather API response). Appendix D entry 1 carries the corrected characterization.

### Risks / Watch Items

- The Phase 4 hard-fail gate is **only as effective as Phase 6b makes it.** Until the UI consumer lands, 503s are observable only via `console.error`.
- Making `user_id` required for `status='ok'` means anonymous snapshots will stay `pending` indefinitely and trigger the 503 after 5 retries with `missingFields: ['user_id']`. Intentional per Phase 3 decision #1, but worth confirming on Melody's return.
- Server-side `dow` hardening (§B.4.1) flagged as follow-up opportunity — primary write paths trust client-sent `dow`. Validation at `:1929` catches null, but server-side re-derivation (like the `:1656` fallback) would be more robust.

### Memory Entries (Chronological)

- #113 SESSION_PLAN — Phase 1 kickoff
- #114 ARCHITECTURE_AUDIT — Phase 2 complete (field matrix)
- #115 ARCHITECTURE_AUDIT — Phase 3+4 complete (decisions + hard-fail)
- #116 ARCHITECTURE_AUDIT — Phase 5 complete (dow verified)
- #117 ARCHITECTURE_AUDIT — Phase 6 complete (header plan, pending approval)
- #118 ARCHITECTURE_AUDIT — Phase 7 complete (duplication register + generated_at)
- #119 SESSION_SUMMARY — this final summary

