# Vecto Pilot

Vecto Pilot helps rideshare drivers review current context, prepare Strategy,
evaluate opportunities with **Offer Analyzer**, and track offers and outcomes.
Melody Dashora owns product intent, driver rules and field experience; the
[partnership agreement](AI_PARTNERSHIP_AGREEMENT.md) records the working principles.

Updated October 4, 2026. This README describes the reviewed source. Check the
[readiness map](docs/architecture/audits/PIPELINE_READINESS_2026-10-04.md) for actual
verification and remaining live acceptance work. A source change, a passing
fixture and a deployed release are separate facts.

## Start here

| Need | Canonical entry point |
|---|---|
| Terms and naming | [LEXICON.md](LEXICON.md) — **Offer Analyzer** is the feature; **offers** are tracked records. |
| Continue engineering work | [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), then the current continuity records and relevant preflight card. |
| Current pipeline order | [MAIN trace](docs/architecture/ai-pipeline.md). |
| Offer Analyzer behavior and remaining work | [Current contract](docs/architecture/OFFER_ANALYZER.md), [roadmap](docs/architecture/OFFER_ANALYZER_ROADMAP.md). |
| Repeatable local/CI checks | [tests/README.md](tests/README.md), `npm run verify`. |
| Database ownership, schema and bootstrap | [Database guide](server/db/README.md), [migrations](migrations/README.md), [environment contract](docs/architecture/DATABASE_ENVIRONMENTS.md). |
| Review evidence and acceptance gaps | [Current readiness map](docs/architecture/audits/PIPELINE_READINESS_2026-10-04.md). |

## Product paths

- **MAIN:** fresh GPS evidence → saved snapshot → complete Briefing → explicit
  Strategy admission → Strategist → VenuePlanner → verified Places/Routes → saved
  rankings. Restoring saved context and preparing a new run have different
  lifecycle rules. See the [ordered trace](docs/architecture/ai-pipeline.md).
- **Offer Analyzer:** browser or configured phone capture → input normalization →
  extraction and owner rules → Phase 1 decision/speech → eligible Phase 2
  enrichment/history. Current Phase 2 runs in process after the response; a spoken
  decision alone does not prove durable storage. Driver outcomes remain separate.
- **Coach:** independent text/voice assistance using owned saved context and
  history. It can discuss Offer Analyzer patterns; the live decision belongs to
  Offer Analyzer. See [Coach](docs/architecture/RIDESHARE_COACH.md).
- **Bars/Lounges and Public Concierge:** independent discovery paths sharing
  verified venue/event data. [Venue contracts](docs/architecture/VENUES.md) and
  [independent pipelines](docs/architecture/INDEPENDENT_PIPELINES.md) describe
  their boundaries alongside Translation and Welcome.

Feature routes include `/co-pilot/strategy`, `/co-pilot/briefing`,
`/co-pilot/bars`, `/co-pilot/offer-analyzer` and `/co-pilot/settings`.
[App.tsx](client/src/App.tsx) is the route source; the
[API registry](docs/api-routes-registry.md) indexes server entry points.

## Development and verification

Use the Node range in [package.json](package.json):
`^20.19.0 || ^22.12.0 || >=24.0.0`. Node 18 is unsupported. The frontend uses
React/TypeScript and Vite; the backend uses Node/Express and PostgreSQL with
Drizzle declarations. The lockfile records installed dependency versions.

From a clean checkout with no application secrets or real `.env*` files:

```sh
npm ci --include=dev
npm run verify
```

The gate runs JSON validation, lint, TypeScript, backend and client fixtures,
dedicated API/UI harnesses, startup fixtures and a production client bundle. It
stops on failure. See [the test guide](tests/README.md) for the exact current
commands and the separate live-database/browser stages. Tests use synthetic
inputs; green fixtures do not establish physical-phone or live-provider behavior.

For an explicitly prepared development runtime, configure credentials through
the environment and follow [database setup](server/db/README.md) before
`npm run dev`. Gateway startup invokes the migration runner. `DATABASE_URL` is
the single database selector; never assume the workspace and deployment share
state. Fresh database installation also needs the reference-data prerequisites
recorded in the database guide. Direct `db:push` is disabled; reviewed versioned
SQL is the migration path.

Provider/model assignments and call parameters live in
[model-registry.js](server/lib/ai/model-registry.js). Application code calls
semantic roles through the [adapter](server/lib/ai/adapters/index.js); copied
model versions or obsolete role-order diagrams are not current configuration.

## Phone setup and operational limits

Use the [Android guide](docs/architecture/ANDROID_SHORTCUT_ANALYZE.md) or
[iPhone guide](docs/architecture/SIRI_SHORTCUT_ANALYZE.md) for Offer Analyzer
capture setup. Verify the installed automation, authenticated request, saved
record and spoken response on the actual phone. Automatic notification capture,
a durable local outbox and observed area-rate analysis are separate work; this
review does not certify those features as running.

The [authentication guide](docs/architecture/AUTH.md) and
[security guide](docs/architecture/SECURITY.md) describe access boundaries.
Never put tokens, private keys, driver data or private chat transcripts in Git.
Generated logs, captures and test reports belong in ignored output folders or
outside the app checkout.

## Maintaining one working source

The current review consolidates into one candidate rather than separate product
branches. Historical recovery branches are evidence until their changes are
reconciled. Record root cause, before/after checks and remaining acceptance work
with each change; update the existing lexicon and relevant canonical guide.
Commit, push and publication are separate actions with their own verified state.

The former README's dated claims, benchmarks and changelog are preserved at
`b4bba633:README.md` and in the external Astra cleanup archive. The
[removal record](docs/architecture/removals/2026-10-04-verification-contract.md)
explains this replacement; historical measurements are not presented as today's
performance or deployment receipt.

Licensed under the MIT License recorded by the project.
