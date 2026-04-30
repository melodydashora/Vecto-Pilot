# Vecto-Pilot Audit Synthesis — April 2026

> **Trust Tier:** Historical — dated assessment snapshot
> **Date:** April 14, 2026
> **Scope:** 65 issues resolved across 9 audit passes (A through BP)
> **Memory table entries:** 93 total (IDs 1–93)
> **Commits:** ~23 across all passes

---

## Executive Assessment

The repo is no longer suffering from a "we do not know what this system is" problem. It now reads as a single-instance production dispatch platform with: a durable snapshot-based context model, a separate briefing intelligence pipeline, a strategist layer for immediate and daily guidance, a venue/Smart Blocks tactical layer, a growing event ETL pipeline, a disciplined documentation system with canonical docs, queues, and trust tiers, and a real test stack (though still not enough proof on the highest-risk paths).

The main remaining risk is not conceptual ambiguity anymore. It is residual proof and operational hardening.

---

## 1. Main Product Features

### A. Snapshot-based driver context

The product centers everything on snapshot_id. A snapshot captures exact driver location, resolved address, timezone, market, time context, weather, air data, and holiday flags.

### B. Briefing intelligence

Generates market context for a snapshot: news, weather, forecast, traffic, local events, school closures, airport conditions — stored in briefings.

### C. Immediate strategist

Produces strategy_for_now (near-term 1-hour tactical) using snapshot context plus transformed briefing context. The daily / consolidated_strategy path was removed 2026-04-27 (`chore/remove-daily-strategy` merge `d39d570f`); the `consolidated_strategy` column is dead-but-defined and is scheduled for removal in the Phase 3 schema fix.

### D. Smart Blocks / venue recommendations

Generates tactical venue recommendations: live event-aware venue selection, drive-time enrichment, staging tips, pro tips, event badges, ranking metadata in rankings and ranking_candidates.

### E. Canonical venue identity system

venue_catalog as canonical venue truth, linked through venue_id, place_id, and fallback identity logic.

### F. Event ETL pipeline

Discovers, normalizes, validates, deduplicates, stores, and reuses event data through canonical ETL modules and discovered_events with schema_version.

### G. Auth + profile + onboarding

Email/password auth, Google OAuth, Uber OAuth linkage, driver profiles, vehicle/service eligibility, session tracking via users, long-lived identity via driver_profiles, custom HMAC auth tokens with explicit session TTL.

### H. Offer analysis / Siri integration

Headless offer-ingestion system for Siri Shortcuts and ride-offer analysis with structured storage in offer_intelligence.

### I. Rideshare Coach / memory / market intelligence

Conversational and memory-bearing layer: coach_conversations, user_intel_notes, coach_system_notes, market/zone intelligence, claude_memory for session knowledge capture.

---

## 2. Subsystem Map

### Core state layer
- users = ephemeral session row
- driver_profiles = durable identity/preferences
- snapshots = durable activity context
- coords_cache = resolved geocode/timezone truth

### Briefing layer
- server/lib/briefing/briefing-service.js
- briefing routes under /api/briefing/*
- briefings table
- event ETL modules

### Strategy layer
- strategist/consolidator provider logic
- strategy routes / blocks routes
- strategies table
- briefing transformation path connecting DB shape to strategist input

### Venue / Smart Blocks layer
- enhanced-smart-blocks.js
- tactical planner / VENUE_SCORER
- rankings, ranking_candidates, venue_catalog, venue_metrics
- live event augmentation

### Client orchestration layer
- CoPilotContext as orchestration center
- BriefingPage / StrategyPage
- /api/briefing/* fetches, /api/blocks/strategy/:snapshotId polling

### Auth / integration layer
- server/api/auth/auth.js, server/middleware/auth.js
- OAuth state tables and Uber connections
- session validation and TTL enforcement

### Docs / governance layer
- canonical architecture index, discrepancy queue, pending queue
- lessons learned, trust tiers, schema rollout exceptions

### Test / validation layer
- Jest backend, Jest client, Playwright E2E
- validation transformers, response schemas, testing doctrine

---

## 3. Source-of-Truth Map

| Domain | Canonical Source | Notes |
|--------|-----------------|-------|
| Architecture | docs/architecture/README.md | Single architecture entrypoint |
| Schema | shared/schema.js | Real schema source, everything defers to it |
| DB policy / rollout | docs/architecture/DB_SCHEMA.md | Plus pending.md for direct-SQL exceptions |
| Auth | docs/architecture/AUTH.md | Token lifecycle, session, OAuth, gaps |
| Security posture | docs/architecture/SECURITY.md | Root SECURITY.md is vulnerability reporting only |
| Scalability | docs/architecture/SCALABILITY.md | PERFORMANCE_OPTIMIZATIONS.md is historical memo |
| Testing doctrine | docs/architecture/TESTING.md | Truth table, coverage, test gaps |
| Briefing shape | docs/architecture/briefing-transformation-path.md | DB shape to strategist input |
| AI role ownership | docs/AI_ROLE_MAP.md | Model/version facts, role contracts |

---

## 4. What Is Healthy Enough to Build On

- **Snapshot to briefing to strategy boundary** — clear what each layer receives and emits
- **Venue identity and Smart Blocks storage** — understandable, documented enough for new features
- **Documentation governance** — trust tiers, canonical indexes, queue discipline, source-of-truth separation
- **Root README honesty** — aligns with internal canonical docs rather than overselling

---

## 5. Prioritized Residual Risks

### P0 — Correctness / Security / Operational Truth

1. **Session binding weaker than UX implies** — auth token not cryptographically bound to session_id or device_id; concurrent-session invalidation not enforced. Now honestly documented but not yet fixed.

2. **Critical path tests still lag importance** — auth/login/logout/session TTL, SSE lifecycle, venue scoring/event relevance, offer analysis rule logic. Infrastructure exists; proof coverage is thin.

3. **Security posture honest but limited** — custom auth token (not standard JWT), public zero-auth hook endpoints by design, RLS not yet implemented, broader hardening pending.

### P1 — Product Quality / Scalability

4. **Single-instance production constraints** — no Redis, no clustering, no CDN, no replica/read split, limited concurrency, synchronous LLM-heavy paths.

5. **Venue economics still heuristic** — simplified value scoring relative to real-world surge/offer intelligence.

6. **Runtime paths documented but environment-sensitive** — split paths (Replit Run vs dev vs deployment) need ongoing discipline.

### P2 — Maintainability / Future-Proofing

7. **Secondary docs will keep drifting** — subsystem READMEs become stale faster than canonical architecture docs. Pattern: keep thin, point to canonical, never repeat claims.

8. **Generated artifacts need trust labels** — enough AI/doc automation that generated maps can look more authoritative than they are.

---

## 6. Audit Pass Summary

| Pass | Issues | Focus |
|------|--------|-------|
| 1 (A-F) | 6 | Schema contracts, AI role map, briefing path |
| 2 (G-L) | 6 | Event source, dual discovery, strategy docs |
| 3 (M-T) | 8 | Time parsing, timezone, rankings, venue status |
| 4 (U-AB) | 8 | Airport conditions, missing routes, UI hardening |
| 5 (AC-AK) | 9 | Architecture index, doc splits, trust tiers |
| 6 (AL-AS) | 8 | Schema/migration/SQL contract alignment |
| 7 (AT-AZ) | 7 | Test coverage, validation gaps, test doctrine |
| 8 (BA-BI) | 9 | Root README, product claims, marketing truth |
| 9 (BJ-BP) | 7 | Auth/session/OAuth/runtime deployment truth |
| **Total** | **65** | **9 passes, 93 memory entries, ~23 commits** |

---

## 7. Final Verdict

This repo is now understandable. The architecture, schema, auth model, testing model, documentation model, and top-level product positioning are much more internally consistent than before the audit.

It is not "finished." The remaining work is proof, hardening, and enforcement: stronger critical-path tests, stronger session binding, stronger security/runtime posture, continued discipline around canonical docs vs thin pointers.

**Most important improvement:** This is no longer a grep-first codebase. It now has the bones of a source-of-truth-first codebase.
