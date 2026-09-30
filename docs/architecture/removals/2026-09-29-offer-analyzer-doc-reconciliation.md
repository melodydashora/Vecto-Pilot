# September 29, 2026 — Analyzer source/documentation reconciliation

## Authorization and scope

Melody asked to fix Analyzer root causes and source-linked documentation before the
next MAIN integration, including removing stale material after preserving valid intent.
Codex/Astra reconciled active docs against the current working tree. This does not
claim a deployment, live database read, provider probe or physical-phone certification.

The starting source/history pointer is commit
`6e98390697dfd3d677702bc64fe206b2383f5279`. Long removed passages are preserved by exact
file/section pointers below, as permitted by this directory's preservation policy.
For example, `git show 6e98390697dfd3d677702bc64fe206b2383f5279:docs/architecture/OFFER_ANALYZER.md`
recovers the complete prior canonical text. No duplicate blanket archive or new memory
store was created. Existing dated evidence was retained.

## Documentation replacements

| Source at the base commit | Retired material / reason | Replacement or preserved intent |
|---|---|---|
| `docs/architecture/OFFER_ANALYZER.md`, §§1–20 and Appendix A | Contradictory oversize/defaults behavior, old file line numbers/models, stale SetupCard/editor state, dormant Coach-action assertions, old suite counts/latency claims, late storage described as if guaranteed. | Same path/numbered sections, source-backed contracts and explicit unverified device/deployment/durability limits. Earlier detailed chronology remains at the base commit. Appendix B attributed decisions retained. |
| `docs/architecture/OFFER_ANALYZER_ROADMAP.md`, §§0–3/4b/5 | Completed tasks still listed as open; conflicting Android test status; silent invalid-token fallback; old deployment/env override assertions and outdated “fix me first” requests. | Remaining gates and future work; D1–D7 retained as historical adopted decisions. D2 inert home/scope keys unchanged. D7 prior full-doc context choice explicitly superseded by current owner-data correction. |
| `docs/architecture/SIRI_SHORTCUT_ANALYZE.md`, Parts1–6 | Old recipes presented as current shared artifacts, fixed deployment URL, stale token/oversize and SetupCard claims, “vision=deep lane,” historical speed claims. | Current browser flow + separate legacy automation contract; preserved joint no-GPS direct-shortcut decision, voice-vs-notification, July/August decode findings and ownership boundary. Prior full action recipes recoverable at base. |
| `docs/architecture/ANDROID_SHORTCUT_ANALYZE.md`, Parts0–6 | Browser-launcher header contradicted by old recommended direct-upload body; unverified current tool menus/prices/versions, fixed URL and latency assertions. | Current token-free browser launcher, separate raw/text upload contracts, exact tested MacroDroid variable→JSON→HTTP ordering, Standard Format/[n] OCR, entire-screen and Samsung battery observations retained with historical provenance. Prior full Tasker/HTTP Shortcuts/MacroDroid recipes recoverable at base. |
| `docs/OFFER_ANALYZER_DRIVER_RULESET.md`, editorial August note only | Old implementation-status paragraph. | Updated editorial links and inert-key/current-rule distinction. Everything beginning `## Verbatim ruleset (as relayed)` is unchanged; July authored framing retained. |
| `client/src/components/offer-analyzer/README.md` | “Older main API does not provide these contracts.” | Current source components/contracts; no rollout claim. Added selected-service/economic-tier and launcher distinctions. |
| `server/api/chat/README.md` | Nonexistent `chat-context.js`, wrong public context route, stale Gemini/default-voice descriptions, wrong DAL path and unsupported blanket log assertion. | Actual brain/context/voice/source data boundary, current owner rules and retired offer mutation behavior. |
| `README.md`, Analyzer section/current roadmap item | Guaranteed approximate latency, “every offer stored,” stale Coach patterns item. | Current source capability + explicit capture/storage/device limits; model details point to registry. |
| `SYSTEM_MAP.md`, external-input block/Analyzer provider block/related takeaways and open items | device_id as identity, impossible headless-FK rationale, stale models/capture modes/storage flow. | Token ownership, current input boundaries, original decision, Phase2 lifecycle and separate MAIN projection. Unrelated historical system diagrams were not rewritten. |
| `docs/api-routes-registry.md`, Analyzer table and nonexistent public chat-context row | Incomplete current routes, weak revision descriptions, wrong public context route. | Current source route/auth/removal/outcome contracts. Legacy hard cleanup remains distinct from reversible editor removal. |
| `docs/architecture/README.md`, Analyzer entries | Canonical doc described as runtime Coach rules. | Focused doc map; current owner data is runtime source. |
| `docs/preflight/ai-models.md` | February `envKey`/`default` convention, old provider-role table, floating aliases, universal parameter/availability assumptions and unconditional probe suggestion. | Registry/caller/adapter source map, explicit pinned-model behavior, verification boundaries. No model pin change. |

Secondary reference surfaces were reconciled only where they described Analyzer or
Coach boundaries: `LEXICON.md`'s obsolete model-override table/router passage;
`UI_FILE_MAP.md`'s capture/components/API table; `server/api/README.md` and
`server/lib/README.md`; Analyzer rows in `docs/AI_ROLE_MAP.md`; the historical
identity phrase in `docs/DOC_DISCREPANCIES.md`; the duplicated Analyzer/Coach call
recipes in `docs/architecture/LLM-REQUESTS.md`; the Analyzer section in
`API_REFERENCE.md`; the conditional storage wording in `DB_SCHEMA.md`; the legacy
`intercepted_signals` hardcoded-threshold/headless-FK explanation in
`database-schema.md`; and narrow `AI_MODEL_ADAPTERS.md`, `MAP.md`, `SSE.md` pointers.
Exact prior passages remain at the base commit. Dated `docs/COACH_PIPELINE_AUDIT.md`
and `docs/HooksCatalog.md` keep their original audit evidence with a current-status
note, rather than rewriting history as though the old findings never existed.

The September11 mobile document remains a dated implementation receipt, with current
Analyzer links added. August incident intake, September10/11 handoffs, September13
audit, prior removals and pending lettered-tier proposal remain historical evidence;
none was deleted to make the current story simpler.

## Runtime removals coordinated in the same task

These are source changes owned by the parent implementation agent, recorded here so
removed rationale stays discoverable:

| Source at base commit | Removed behavior | Reason and replacement |
|---|---|---|
| `server/api/chat/chat.js`, `getOfferAnalyzerRules()` and “Splice the read-only offer analyzer rules” block | Process-cached full `OFFER_ANALYZER.md` plus raw `model-registry.js` appended to every brain prompt. | Previously accepted D7 context policy is superseded by actual owner config/service data. DAL reads saved rules per turn with source/error/hash/version provenance; source JSON supplies the data. |
| `server/api/chat/chat.js`, offer branches in `executeActions()` | Executable `LOG_OFFER_DECISION`, `UPDATE_OFFER_DECISION`, `BACKFILL_OFFER_INTEL` model tags. | They allowed Coach to create/change Analyzer evidence; BACKFILL could overwrite non-null values. Retain tag detection and explicit not-saved errors; retain historical reads and Daily Offers controls. This enforces the existing no-Coach-live-offer-verdict boundary. |
| `server/lib/ai/rideshare-coach-dal.js`, offer mutation methods; `server/api/rideshare-coach/` action schemas | Unused-after-retirement write implementations/schema permissions. | Remove the writable path rather than only telling the model not to invoke it; historical tables/reads are preserved. See actual diff for exact method/schema deletions. |
| `server/lib/ai/model-registry.js`, Analyzer comments | Obsolete env-revert and timeout-race narrative. | Current registry/adapter lifecycle explanation; pins and role parameters unchanged by the documentation correction. |

Retiring the old offer actions resolves the source issue that historical roadmap L10
called “dormant”/todo#38. A prior empty-row observation did not prove those handlers were
unreachable. No live continuity-table status change is claimed by this document.

## Preserved distinctions

- Selected service identity is separate from eligibility and economic routing; null
  legacy selection is unverified, not an invented all-services choice.
- `home` and geographic scopes remain inert/no UI (D2).
- The original spoken decision, deep-model dissent and actual driver outcome remain
  separate. A direction rule does not automatically exclude its anchor venue.
- Current owner config is not historical offer history, and stored/effective hashes
  differ when a valid older config is migrated.
- Corrected rows carry `parsed_data_json.phase1_contract_version=1`. Missing marker
  leaves legacy calculation provenance unverified, not necessarily wrong. Existing
  rows are not blindly rewritten/deleted or retroactively certified by new code.
- Phase2 is still in-process, without a durable queue; cancellation is not durability
  or a billing guarantee. MAIN Analyzer integration remains held.

## Root causes, corrections and test sources

This matrix records the mechanism addressed, not an assertion that every historical
row was wrong. Test sources use synthetic fixtures; execution receipts remain separate.

| Root cause | Correction/source | Regression evidence source |
|---|---|---|
| Modality branches trusted model acceptance or skipped incomplete numeric checks; model outage could turn arithmetic pass into ride ACCEPT. | `phase1-decision.js` common normalization/merge/adjudication and hook convergence; required evidence/judgment report before ride acceptance. Identity-only Share/service rejection retains its category while suppressing untrustworthy numeric/hourly audio. | `tests/offers/decision-adjudication.test.js`, `share-second-sweep.test.js`. |
| OCR/model fare or complete leg disagreements silently favored one source and could produce a false ACCEPT. | Compare concrete price and full-OCR concrete pickup/ride primitives; `extraction_conflicts:[{field,ocr,model}]` produces manual NO DATA. Tokened conflicts enter forensic enrichment but keep numeric/NOTIFY quarantine, regardless of later agreement. Aggregate arithmetic differences remain server-recomputed, not source conflicts. | `tests/offers/decision-adjudication.test.js`: price-decimal conflict, four pickup/ride mile/minute conflicts, quarantine/retained evidence and allowed aggregate correction. |
| Active-time compared/stored inconsistent denominators; ARP could use active miles; mixed Phase1/deep legs could corrupt totals. | Chosen-basis decision fields/voice; total-mile ARP; one storage numeric bundle, separate full-trip columns. | `decision-adjudication.test.js`, `rules-engine-v3.test.js`, `rules-engine-parity.test.js`, `share-second-sweep.test.js`. |
| Known services collapsed identity or settings controls did not match actual economic routing. | `shared/driver-services.js`, resolver metadata, explicit service gates and shared UI groups; legacy null remains unverified. XXL/Black SUV economic inheritance preserved. | `driver-services.test.js`, `selected-service-resolution.test.js`, `selected-services-controls.ui.test.tsx`, `selected-services-page.ui.test.tsx`. |
| Nullable legacy service list newly blocked Continue despite valid existing preferences/rules. | `main-run-admission.js` accepts unchanged null only with otherwise complete setup and valid saved rules; summary names unknown selection. Empty/invalid/ineligible remains invalid. | `tests/strategy/main-run-admission.test.js`, `tests/client/run-setup-summary.test.tsx`; synthetic route/migration integration receipt from implementing agent. Not a live account reproduction. |
| Admission compared migrated config hash with stored raw hash, blocking valid older rules unless resaved. | Verify raw stored hash first, then migrate/validate; pin effective config with original revision/hash and preserve DB row unchanged. | `tests/strategy/main-run-admission.test.js` and synthetic API/PGlite migration tests exercise valid older v2 plus null services, malformed config and mismatched hash. |
| Deadlines abandoned provider work/retry paths. | Hook controllers/timer cleanup; adapter/router signal propagation and no retry after abort. | `tests/ai/offer-cancellation.test.js`, `hedged-router-sequential.test.js`. No billing/durability guarantee. |
| Later malformed/implausible extraction could contaminate stored numeric evidence/previews. | Envelope validation, normalized `storageNumbers`, quarantine of typed financial/leg fields and NOTIFY amounts; raw evidence retained. | `tests/offers/share-second-sweep.test.js`, `decision-adjudication.test.js`, `delivery-and-sanity.test.js`. |
| Coach consumed stale docs/registry text instead of current owner rules; selected services omitted and inactive primary vehicle possible. | `getOfferRules()` per-turn owner read with source/hash/version/error states; explicit selected services/active primary projection and saved-source JSON. | `tests/coach/incremental-context.test.js`, `chat-completion.test.js`, `restoration.test.js`. |
| Coach model tags could create/update/overwrite offer evidence despite the live-verdict boundary. | Retire three mutation handlers/DAL writes/schema permissions; retain detection with not-saved error and historical reads. | `tests/coach/chat-completion.test.js`, action schema/validation tests. |
| Admission’s full rule receipt leaked into MAIN model prompts before integration decision. | `mainDriverContext()` supplies profile/vehicle only; full admission receipt remains for freshness checks. Null service choice gets service-neutral instructions. | `tests/strategy/driver-economics-prompt.test.js`, `tactical-pickup-preferences.test.js`. |
| New code could make old stored rates appear retroactively certified. | New `phase1_contract_version`, source/quarantine fields and Coach legacy-evidence warning; no historical row rewrite. | `tests/offers/share-second-sweep.test.js`, `tests/coach/incremental-context.test.js`. |

## Verification

Documentation checks verify relative links/source pointers and unchanged verbatim spec
body against the base commit. Implementation commands/results belong to the task
receipt, not a new live-runtime claim. The documentation reconciliation checked 70 new/changed relative file targets with
no missing destination, confirmed the verbatim spec body byte-for-byte against the
base commit, confirmed all seven historical D1–D7 rows unchanged, and passed
`git diff --check`. Existing unrelated broken links in the architecture index were
identified separately, not concealed as newly introduced failures. No historical
suite count was copied into the canonical doc as current proof.

### September 29 correction verification receipt

These are local working-tree results, with external model/network boundaries mocked
and admission/outcome database tests isolated in memory; they are not production or
physical-phone results. The final batches had no overlapping test-suite files:

| Batch | Passed suites / tests |
|---|---|
| Backend: offers, Coach, AI cancellation/router, admission/readiness and MAIN prompt boundaries | 31 / 465 |
| Full client suite | 30 / 252 |
| Analyzer editor controls (`tests/offers/jest.ui.config.cjs`) | 4 / 41 |
| Outcome API (`tests/offers/jest.api.config.cjs`) | 1 / 12 |
| Settings (`tests/settings/jest.settings.config.cjs`) | 4 / 40 |
| Total | 70 / 810 |

`npm run lint`, `npm run typecheck`, and the client production build passed. The build
went to a temporary output directory and was not activated or deployed. Its existing
large-chunk and browser-data-age warnings remain. Final link checks found no newly
broken relative targets, and the verbatim specification and historical D1–D7 rows
were preserved. The private recovery checkpoint retains command/result artifacts and
source fingerprints in the existing coordination directory.

The precise error on Melody's account was not reproduced. Tests establish the corrected
legacy-configuration/Continue behavior; real-device response time, durable Phase 2 work,
and accuracy of pre-correction historical rows remain explicit limits in the roadmap.
