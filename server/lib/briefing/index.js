// server/lib/briefing/index.js — barrel forwarding to the canonical facade.
//
// 2026-05-02: Workstream 6 commit 10 — Master Architect Barrel Decision.
// briefing-service.js is the canonical entry point: a 38-line shim that
// re-exports all 17 public symbols from briefing-aggregator.js (orchestration)
// and pipelines/*.js (per-pipeline data fetching).
//
// This file is intentionally minimal — a single wildcard re-export. It exists
// as a defensive safety net for any caller that uses bare-directory imports
// (`from '../lib/briefing'`). Currently has zero such callers (all external
// consumers import from briefing-service.js directly), but the wildcard
// re-export means this file is self-maintaining: adding/removing a public
// symbol from briefing-service.js automatically propagates here without any
// edit to this file.
//
// Identity preservation: ESM module-singleton + binding-preserving re-exports
// mean a caller importing via this barrel reaches the SAME function references
// as a caller importing directly from briefing-service.js or briefing-aggregator.js.
// The inFlightBriefings concurrency Map remains a single per-process instance.

export * from './briefing-service.js';
