# Pass D — Client Field Survivability

**Date:** 2026-04-16
**Auditor:** Claude Opus 4.6 (architect on duty)
**Triggered by:** DECISIONS.md #16 needed a test case; `beyond_deadhead` computation existed on server but never reached client rendering.
**Status:** Closed by commit 6b321afb.

## Scope

Verify that every field the four-hop contract promises actually survives from server compute to client render.

## Finding

`beyond_deadhead` was computed (`tactical-planner.js:531`), persisted (`enhanced-smart-blocks.js:568`), but not serialized (`transformers.js` missing field), not mapped (`co-pilot-context.tsx` missing field), and not rendered (`StrategyPage.tsx` missing badge). Same defensive field-by-field pattern as server side — proven to recur.

## Outcome

Commit 6b321afb landed the full four-hop chain:

- `transformers.js:264` — SERIALIZE
- `co-pilot-context.tsx:657` — MAP
- `StrategyPage.tsx:507` — RENDER (amber badge + border tint for rank > 3 cards)

Doctrine validated in practice: fixing one instance exposed the pattern, four-hop rule caught the next instance immediately.
