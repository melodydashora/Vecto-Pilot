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

- [x] **Market fallback policy — RESOLVED.** `market` IS a required field. If missing after enrichment, it is a **hard-fail** condition. The historic city-substitution fallback is **NOT approved** and must be removed. Any code path that substitutes `city` for a missing `market` is a bug to be fixed in Phase 7 or when encountered.

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

