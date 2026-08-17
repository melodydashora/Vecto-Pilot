# Removed: Offer Analyzer design/plan docs + the code comments that pointed at them (2026-08-17)

**Sweep context:** Melody asked (2026-08-17) to consolidate every Offer Analyzer document
to match the codebase, delete the ones that only add noise, and leave one "as built"
doc + one "plan going forward" doc + the two end-user shortcut guides. Ground truth was
established by full-file reads (session workflow, 10 readers) before anything was
removed. No UI code was changed (Melody's direction); the code edits below are
comment-only pointer fixes required by `app_rules: comment-hygiene`.

## 1. Documents deleted (content merged first; history in git)

| Deleted file | Merged into | Why it left |
|---|---|---|
| `docs/architecture/OFFER_ANALYZER_EDITOR_PLAN.md` (2026-06-01 plan, "IMPLEMENTED" banner) | `OFFER_ANALYZER.md` §3 (three-decisions model), §13 (page), Appendix A/B; `OFFER_ANALYZER_ROADMAP.md` (§7–§9 phases/open decisions/ML notes) | Described the pre-v3 pipeline (`PHASE1_PROMPTS`, device_id ownership, `driver_profiles` token proposal) as "current"; its storage/API sections were already marked superseded by the v3 design doc. Two build-plan docs for a built feature was the noise. |
| `docs/architecture/OFFER_RULESET_V3_DESIGN.md` (2026-07-03 approved design) | `OFFER_ANALYZER.md` §6 (engine, v3 schema, spec→v3 mapping), §7 (identity), §10 (Phase 2), §11 (storage), §12 (API), §13 (page), Appendix B (Melody's decisions verbatim); `OFFER_ANALYZER_ROADMAP.md` (non-goals → open items) | The design was built; the as-built doc now carries every fact from it with `file:line` citations. Its "measured p50 5324ms / thinkingLevel HIGH is the lever" ground-truth section is superseded by the 2026-08-14 sprint (`removals/2026-08-14-offer-analyzer-thinking-stepdown.md`). |
| `docs/guides/siri-shortcuts-guide.md` (generic Shortcuts tutorial, created 2026-04-14 with the memory API) | `SIRI_SHORTCUT_ANALYZE.md` Parts 2–4 (the generic build/trigger how-to, rewritten around the two canonical shortcuts) | Wrong domain throughout (`vectocopilot.com`), examples against `/api/memory` (not a driver surface), and no analyzer contract — it competed with the real shortcut doc for the "how do I build the shortcut" question. |

Kept and unchanged: `docs/OFFER_ANALYZER_DRIVER_RULESET.md` (Melody-authored verbatim spec;
one Claude editor's-note pointer added, spec text untouched).

## 2. Code comments repointed (comment-only edits)

The retired docs were cited from code. Each pointer now names the section of
`docs/architecture/OFFER_ANALYZER.md` that holds the same content.

1. `server/lib/offers/rules-engine.js:4-5` — was
   `full verbatim spec (docs/OFFER_ANALYZER_DRIVER_RULESET.md). Design:` /
   `docs/architecture/OFFER_RULESET_V3_DESIGN.md.` → now `As-built doc: docs/architecture/OFFER_ANALYZER.md §6 (the v3 design doc was merged into it 2026-08-17).`
2. `server/lib/offers/rules-engine.js:8-9` — was
   `Before 2026-06-20 the rules lived in TWO places that drifted (see` /
   `docs/architecture/OFFER_ANALYZER_EDITOR_PLAN.md §1.1):` → now `(history: docs/architecture/OFFER_ANALYZER.md Appendix A, 2026-06-20 entry):`
3. `server/lib/offers/ruleset-schema.js:8` — was `// Design: docs/architecture/OFFER_RULESET_V3_DESIGN.md §6.` → now `// Doc: docs/architecture/OFFER_ANALYZER.md §6.6 (write-time validation) and §7 (read posture).`
4. `server/lib/offers/ruleset-store.js:9` — was `FAIL POSTURE (named conflict, resolved in design §6):` → now `FAIL POSTURE (named conflict, resolved 2026-07-03; OFFER_ANALYZER.md §7):`
5. `server/api/offer-analyzer/index.js:4` — was `// Design: docs/architecture/OFFER_RULESET_V3_DESIGN.md §7.` → now `// Doc: docs/architecture/OFFER_ANALYZER.md §12 (route contracts).`
6. `server/api/offer-analyzer/index.js:54` — was `(design §6)` → now `(OFFER_ANALYZER.md §7 fail posture)`.
7. `server/api/offer-analyzer/index.js:159-160` — was `(the §0` / `conflation fix: "accepted" no longer pretends …)` → now `(the three-` / `decisions rule, OFFER_ANALYZER.md §3: "accepted" never pretends …)`.
8. `server/api/hooks/analyze-offer.js:915` — was `(the §0 conflation bug in the editor plan doc)` → now `(the three-decisions rule, OFFER_ANALYZER.md §3)`.
9. `client/src/lib/offer-ruleset-schema.ts:3` — was `(docs/architecture/OFFER_RULESET_V3_DESIGN.md §3)` → now `(docs/architecture/OFFER_ANALYZER.md §6.2 DEFAULT_RULESET)`.
10. `client/src/constants/apiRoutes.ts:223` — was `docs/architecture/OFFER_RULESET_V3_DESIGN.md §7` → now `docs/architecture/OFFER_ANALYZER.md §12`.
11. `shared/schema.js:1930` — was ` * Design: docs/architecture/OFFER_RULESET_V3_DESIGN.md §5.` → now ` * Doc: docs/architecture/OFFER_ANALYZER.md §11 (data model).`

**Reason (all):** a comment that points at a deleted file is a stale comment by
definition; the section pointers keep the "why" reachable from the code.

## 3. Config example corrected

- `.env.local.example:117` — was `OFFER_ANALYZER_DEEP_MODEL=gemini-3.5-flash` → now
  `gemini-3.1-pro-preview` (registry default) with a do-not-downgrade note. **Reason:**
  the old value reproduced the exact Flash downgrade recorded in `lessons_learned` #9
  (Phase 2 silently ran Flash for ~12 days while telemetry claimed Pro). The real
  `.env.local` already matched the registry.

## 4. Not removed (deliberately)

- `client/src/components/offer-analyzer/SetupCard.tsx` still points at the July
  "Analyze 2" iCloud link and instructions — **stale, but UI edits are deferred by
  Melody's direction this session**; tracked as roadmap L3.
- `tests/integration/test-ocr-hook.js` — stale manual script (expects `data.analysis.decision`);
  not collected by jest; roadmap L8 decides update-vs-delete.
- Dated audits that mention the analyzer (`docs/HooksCatalog.md`, `docs/architecture/audits/*`,
  `FullAuditWBriefing2026May13.md`, `docs/reviewed-queue/*`) — history, left as-is.
