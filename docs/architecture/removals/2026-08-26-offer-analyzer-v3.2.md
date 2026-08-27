# Removals — 2026-08-26 — Offer Analyzer v3.2 (tripwire + delivery lane)

Per `app_rules: comment-hygiene`. Session: intake of Melody's 2026-08-17 → 08-24 handoff
pack (`docs/review-queue/PLAN_intake-2026-08-26-offer-analyzer-handoffs.md`).

1. **`server/api/hooks/analyze-offer.js` — inner `toNum` and its comment** (was inside the
   route handler, ~line 639):
   > `// 2026-07-03: coerce model-sourced numerics — vision JSON can carry numbers`
   > `// as strings ("1.14"), and .toFixed on a string threw a TypeError → 500,`
   > `// violating the always-answer contract (adversarial review finding).`
   > `const toNum = (v) => { … }`
   **Reason:** hoisted to module scope (the new final sanity gate runs before that point
   in the handler and needs it). The 2026-07-03 rationale is preserved on the module-level
   definition; the in-handler line now says only where it went.

2. **`server/api/hooks/analyze-offer.js` — `buildVoiceLine` qualifier comment** "Order
   matters (first match wins): 'too far' before 'time', 'fallback' before 'low'." —
   extended, not removed: `'low hourly'` (delivery) now precedes `'low'`.

3. **`docs/architecture/ANDROID_SHORTCUT_ANALYZE.md` Part 4** — the 2026-08-17 plan-only
   MacroDroid table (8 steps incl. a "JavaScript Code join the array" step and a Quick
   Settings trigger) replaced wholesale by the field-verified 2026-08-17/18 build (Melody's
   Samsung). **Reason:** the join step is unnecessary (server parses the `[n]:` array
   rendering natively — verified by execution 2026-08-26) and the action ORDER in the old
   table let a Set-Variable-after-HTTP bug through. Old text in git history at `982745c7`.

4. **`docs/architecture/OFFER_ANALYZER.md` §18** — "As of 2026-08-17: 5 suites / 66 tests"
   → stale (9/114 at intake, 10/136 after). Replaced with the measured figures.
