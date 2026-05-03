# PLAN — Workstream 6 Step 2: Catalog Cleanup (Eradicate `venue_catalog.source_model`)

**Date:** 2026-05-03
**Branch:** `feat/workstream6-catalog-cleanup` (off `main` after Step 1 merge `92c960c0`)
**Status:** Approved by Master Architect 2026-05-03 (conversational), executing
**Companion plan:** `PLAN_workstream6_remaining-2026-05-02.md` (line 411 scopes Step 2 separately)

---

## 1. Objective

Eradicate the dead `venue_catalog.source_model` column. Original directive proposed a dual-write + backfill migration to `discovered_events`; pre-work audit found:

1. `venue_catalog.source_model` is empty (0 of 699 rows populated)
2. `discovered_events.source_model` was deliberately removed 2026-01-10 (model identity is pipeline-implicit)
3. 58% of venues have non-event provenance — moving `source_model` to events is semantically wrong

Per claude_memory row 273 ("redesign from first principles when audit findings change the problem statement"), the directive was reframed: **eradicate, don't migrate**.

The `source` and `discovery_source` columns on `venue_catalog` are KEPT (Option B from the telemetry analysis). They describe catalog-entry provenance (external supplier vs internal flow), not AI identity, so they don't violate the model-agnostic mandate that doomed `source_model`.

## 2. Approach

Five-phase execution against `feat/workstream6-catalog-cleanup`:

| Phase | Action |
|---|---|
| 0 | Git resync to pull Step 1 merge into local main, recreate working branch |
| 1 | Author + apply `migrations/20260503_drop_venue_catalog_source_model.sql` |
| 2 | Sync Drizzle schema (`shared/schema.js:309`) |
| 3 | Remove writer field + JSDoc (`server/lib/venue/venue-cache.js:195, 247`) |
| 4 | Add catalog-provenance doctrine note to `CLAUDE.md` |
| 5 | Verification: typecheck, lint, parity smoke, fresh venue creation, schema check |

Plus a single-commit follow-up fixing the `venue-cache.js:249` conflation (`venue.source` mapped to BOTH `source` and `discovery_source` columns; should be a distinct input).

## 3. Files Affected

| File | Action | Detail |
|---|---|---|
| `migrations/20260503_drop_venue_catalog_source_model.sql` | Create | Idempotent `ALTER TABLE … DROP COLUMN IF EXISTS source_model;` wrapped in `BEGIN/COMMIT` |
| `shared/schema.js` | Modify line 309 | Remove `source_model: text("source_model")` from `venueCatalog`; replace with one-line history comment |
| `server/lib/venue/venue-cache.js` | Modify lines 195, 247 | Remove `@param venue.sourceModel` JSDoc + `source_model: venue.sourceModel` insert field |
| `CLAUDE.md` | Modify | Add "Catalog Provenance Doctrine (2026-05-03)" subsection |
| `docs/review-queue/PLAN_workstream6_step2_catalog-cleanup-2026-05-03.md` | Create | This document |

**Out of scope (verified by grep):** `shared/schema.js:937` has a `source_model` column on a different table (LLM call logging, `'gpt-5.2', 'claude-opus'`). Not touched.

## 4. Test Cases

Per Rule 1 — explicit test cases the implementation must satisfy:

| # | Test | Expected Outcome |
|---|---|---|
| T1 | `psql … -c "SELECT COUNT(*) FROM venue_catalog WHERE source_model IS NOT NULL;"` (pre-migration) | `0` — confirms no data loss |
| T2 | Apply migration | `BEGIN / ALTER TABLE / COMMIT` no errors |
| T3 | `psql … -c "\d venue_catalog"` (post-migration) | `source_model` column absent; `source` and `discovery_source` still present |
| T4 | `node --check shared/schema.js && npm run typecheck` | No errors |
| T5 | `node --check server/lib/venue/venue-cache.js && npm run lint` | No errors |
| T6 | `node scripts/briefing/parity-smoke.mjs` (Step 1 smoke check) | Exit code 0; briefing read-path JSONB shapes intact |
| T7 | Trigger a fresh venue creation via API (`/api/blocks-fast` or coach chat); verify new row inserts cleanly | New `venue_catalog` row, no errors, `source` and `discovery_source` populated correctly |
| T8 | `grep -rn "source_model\|sourceModel" --include="*.js" --include="*.ts" server/ shared/` (post-cleanup) | Only references on the OUT-OF-SCOPE LLM-call table at `shared/schema.js:937` (and historical comments) — no live `venue_catalog` references |
| T9 (follow-up commit) | `venue-cache.js:249` no longer maps `venue.source` to `discovery_source`; either accepts a distinct `venue.discoverySource` input or hardcodes a clear default | New venues from venue-cache callers have meaningfully distinct `source` and `discovery_source` values |

## 5. Telemetry Analysis Summary (Approved Option B)

`source` (688/699 populated) and `discovery_source` (699/699, NOT NULL) are kept as write-only operational telemetry. They serve ad-hoc audit queries about catalog-growth provenance. No live readers in code, but storage is trivial and dropping them removes optionality. They describe the catalog entry, not the AI's identity, so they do not conflict with the model-agnostic mandate.

The `venue-cache.js:249` conflation (writing `venue.source` to BOTH columns) is fixed in the follow-up commit; the address-resolver path already does the right thing.

## 6. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Data loss on column drop | Zero | 0/699 rows populated — verified via SELECT pre-migration |
| Live readers breaking | Zero | Grep across `server/`, `shared/`, `client/src/` returned no live readers |
| FK / index dependencies | Zero | `\d venue_catalog` shows no constraints or indexes referencing `source_model` |
| Drizzle schema drift breaking ORM | Low | Schema sync immediately follows migration; typecheck gates |
| Runtime venue insertion failure | Low | Writer cleanup is a single-line removal; venue-cache.js is the only writer |
| Migration fails on prod (Neon) when applied later | Low | `ALTER TABLE … DROP COLUMN IF EXISTS` is idempotent; tested on dev (Helium) first |

## 7. Doctrine Note (lands in CLAUDE.md)

```
### Catalog Provenance Doctrine (2026-05-03)

`venue_catalog.source_model` was dropped in Workstream 6 Step 2, mirroring the
2026-01-10 removal of the same column from `discovered_events`. Doctrine: AI
model identity is pipeline-implicit (Gemini for events, model-agnostic adapter
at runtime for venue creation), so per-row `source_model` is dead telemetry.

Catalog-entry provenance still lives on `venue_catalog`:
  - `source`           — external supplier (`google_places_new`, …)
  - `discovery_source` — internal flow (`address_resolver`, `briefing_discovery`, …)

These are write-only operational telemetry — useful for ad-hoc audit queries,
not consumed by runtime code. Do NOT add a new `source_model`-style column on
`venue_catalog` or `discovered_events`; if model-attribution telemetry becomes
genuinely needed, route it through structured logging (matrixLog), not the
data tables.
```

## 8. Approval Trail

- **2026-05-03 (initial)** Master Architect proposed Migration A (dual-write + backfill `source_model` to `discovered_events`)
- **2026-05-03 (audit pushback)** Replit Claude surfaced 3 findings: empty column, 2026-01-10 doctrine, non-event provenance for 58% of venues
- **2026-05-03 (reframe)** Master Architect: "We are no longer migrating source_model; we are eradicating it. Option B approved for source/discovery_source."
- **2026-05-03 (execution)** "Plan Approved + Execute Sync & Eradication" — sync sequence + 5-phase execution + venue-cache.js conflation follow-up cleared.
