# Independent pipeline retirement and documentation reconciliation

Authorized by Melody's September 29 request to fix complete pipeline contracts and
remove stale duplicate guidance, with the root review explicitly assigning dormant
unsafe event-sync retirement. Base: `main`,
`6e98390697dfd3d677702bc64fe206b2383f5279`, plus preserved working changes.
The previous implementations and document bodies remain recoverable from Git at
that base. No application records, secrets or private memo contents are included.

## Retired implementation bodies

| Path retained as an explicit failure shim | Evidence and reason | Replacement |
|---|---|---|
| `server/jobs/event-sync-job.js` | Full source read; repository caller search found no runtime starter. Gateway comment records removal in February. Old UTC start-date cleanup could deactivate a still-running multi-day event; repeated starts/untracked initial timeout and stop-during-run could leave a scheduler alive; caught errors allowed standalone success. | Current admitted MAIN → saved Briefing discovery; cleanup stays in the separately active `server/jobs/event-cleanup.js`. |
| `server/scripts/sync-events.mjs` | Full source read; sole active-code importer was the dormant job above. Independent provider dispatch, server-date fallback, absent country/timezone validation, truthy-coordinate tests, precision truncation and its own event upsert duplicated current discovery without current contracts. It also created a separate unclosed pool. | `server/lib/briefing/pipelines/events.js` through the admitted flow described by [ai-pipeline.md](../ai-pipeline.md). |

No route or provider is silently rerouted. Existing exported calls throw
`legacy_event_sync_retired`; both direct CLI entry points print the replacement
reference and exit 1. Importing a shim does not load a DB, environment file,
provider or timer. The scheduler stop export is inert because no run can start.
`tests/independent/retired-event-sync.test.js` verifies eight old exported calls,
no scheduler timers, and both inert CLI failure paths: 11 tests passed. It never
executes the former providers/writer.

Airport/market/country seeds, schema/migration history and the active per-venue
cleanup were preserved. `change-analyzer-job.js` has no runtime starter found but
was not deleted: it is a separate repository documentation helper, not a competing
event discovery writer. This review is a bounded entry inventory, not evidence
that every manual script has been run or certified.

## Reconciled active documents

| Rewritten path | Removed stale claims / retained context | Current source-backed replacement |
|---|---|---|
| `docs/architecture/TRANSLATION.md` | Removed the retired browser overlay/API walkthrough, old model/cost/latency assumptions and misleading device-auth claim. September browser retirement receipt is retained. | Current Siri hook, parser, strict output, metadata/limiter and cancellation trace at the same path. Coach TTS links to its canonical guide. |
| `server/lib/strategy/README.md` | Removed nonexistent module list, retired daily generator, copied model pins and outdated freshness rules. | Current module/source/admission map, exact venue identity/timezone and precision boundaries; links to MAIN. |
| `server/scripts/README.md` | Removed old multi-provider event-sync usage, provider names/exports and obsolete rate/cost assumptions from that section. Other historical maintenance entries are identified as requiring source inspection. | Explicit event-sync retirement and source references; seed capabilities retained. |
| `docs/architecture/AUTH.md` | Replaced the April line-number map, pre-sid session descriptions, old logout ordering and unimplemented-feature checklist. Retains JWT migration, account-row preservation and zombie-snapshot history/why. | Current login/OAuth/credential transaction, shared response projection, session clocks, client/account transition and non-mutating stream-auth helper. |
| `docs/architecture/USER_PREFERENCES.md` | Removed wrong vehicle PK/FK, home-as-GPS fallback, “Strategy/planner not integrated” and automatic-learning implications. | Canonical saved settings, explicit service intent, legacy null-selection compatibility, revisioned save/Continue, bounded MAIN projection and saved-only Analyzer hold. |

[INDEPENDENT_PIPELINES.md](../INDEPENDENT_PIPELINES.md) is the current entry map for
Welcome, Siri, registration address validation and manual/background boundaries.
[Coach consolidation receipt](2026-09-29-coach-doc-consolidation.md) separately
lists the four duplicate Coach documents deleted in this same review. This receipt
does not delete or replace previous handoffs, evidence or migration provenance.
