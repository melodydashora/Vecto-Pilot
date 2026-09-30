# Offer / FAA frontend sprint — September 11, 2026

Provenance: Replit Codex/Astra, under Melody's four-hour implementation request
relayed by Desktop Astra. Frontend candidate only; Claude owns integration and
backend/auth/schema/migrations. Main and its uncommitted setup changes are intact.

Base: `6a97c0584cc868fe8e2c7610c79f44a1b53ed1db`, authoritative main at worktree
creation. Branch: `astra/offer-faa-20260911`. Recovered references compared first:
Offer `41bcb4b3`, FAA `2bf700e6`; their client changes were missing on this base.
This patch contains no backend, auth-provider, query-constant or dependency edits.

## Driver-visible changes

- Offer outcomes are drafts until explicit Save. Confirmed responses collapse to
  a compact summary with Edit. Zero, unknown amounts, notes, Other/error,
  refresh failures and revision conflicts retain their distinct meanings.
- A failed background list refresh no longer destroys open drafts. An edited
  offer that leaves the latest 25 remains visible until Save or Cancel.
- Changing drivers hides the previous list immediately and cancels in-flight
  requests. The query key includes user identity; requests capture the active
  context token. This complements the `899c874a` AuthProvider cache cleanup.
- Charts use complete rolling 7/30/90-day server counts, not the latest 25.
  Analyzer recommendations and driver outcomes stay separate. Invalid count
  partitions/bounds cannot become financial claims. GPS-local timestamp labels
  preserve exact source instants; absent GPS timezone stays unresolved.
- FAA disruptions override optimistic model badges, with neutral unknowns,
  nullable duration, ground stops, scoped restrictions and original source/fetch
  timestamps. Restrictions do not claim the airport is closed or reopening.
  Airport collapse is keyboard-operable; narrow layouts wrap names/advisories.
- Airport pending, missing, failed and resolved-empty states remain distinct.
  Failure reasons remain visible alongside retained airport identities; empty
  results require the server reason. Legacy directional data cannot invent an
  absent direction or contradict an observed FAA disruption with On Time.

## Required backend contracts (Claude-owned)

Offer: reconcile `server/api/offer-analyzer/index.js`,
`server/lib/offers/outcome-input.js`, `shared/schema.js`, forward migration
`20260910_offer_outcome_revision_other.sql`, associated docs and API tests from
`41bcb4b3` against current leaf-fixes. GET must expose outcome revision; POST must
honor `expected_revision` and return complete canonical outcome fields; 409 must
carry `current`. Keep precise timestamp compatibility and legacy refresh error.
The chart requires `/api/offer-analyzer/offers/stats?period=7d|30d|90d` and the
documented full `[start,end)` count partitions. Old main saves incomplete responses,
rejects Other and lacks the chart route, so frontend alone is not rollout-ready.

FAA: reconcile parser/request, airport pipeline and snapshot mapper from
`2bf700e6`; preserve `faa_has_delays`, `faa_ground_stops`, nullable minutes,
restriction start/end/scope, coverage and original source/fetch timestamps.
The two UI test/config files under `tests/briefing/` are Astra-owned; other
Briefing and FAA backend tests remain Claude-owned.

## Focused evidence on this frontend tree

```sh
node /home/runner/workspace/node_modules/jest/bin/jest.js --config tests/offers/jest.ui.config.cjs --runInBand
node /home/runner/workspace/node_modules/jest/bin/jest.js --config tests/briefing/jest.airport-ui.config.cjs --runInBand
node /home/runner/workspace/node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit --pretty false
node /home/runner/workspace/node_modules/eslint/bin/eslint.js client/src/components/offer-analyzer/{OffersCard,OfferOutcomeRow,OffersDecisionChart}.tsx client/src/components/briefing/AirportCard.tsx --max-warnings 0
git diff --check
```

Offer 24/24 UI tests; FAA 20/20 UI tests; client TypeScript, focused ESLint and
diff checks passed. New tests first reproduced draft loss, cross-account list
reuse, inconsistent summary acceptance and latest-25 eviction before fixes.
DOM tests use synthetic data; Offer select/chart primitives are substituted.
Six additional FAA tests first reproduced pending/empty/failure-state mistakes
and contradictory or fabricated legacy direction labels before the follow-up
fixes. This completes the AirportCard leaf of todo #8, not its other sections.

Separate synthetic Chromium checks use actual CSS, Radix and Recharts at
320/768px: Save/Edit/Cancel, pending-save controls,503/409 draft preservation,
period switching, keyboard airport collapse, no horizontal overflow or page
errors. A clipped Unknown placeholder at320px was fixed with stacked earnings
inputs; targeted visual readback is recorded under the ignored sprint artifacts.
The follow-up browser probe reproduced a long failure-reason overflow and then
passed after constrained text wrapping: document, body and root stayed 320px,
the alert stayed 268px, and airport identity and accurate legacy labels remained
visible. Before/after screenshots and receipts are in `artifacts/faa-browser-v2`.
No application gateway or provider/database was started by these checks.

## Recovery and remaining work

Versioned patch/checksum/commands are published in the shared ignored sprint
directory; consult `astra-status.md` for the newest version before applying.
All new/untracked source files must be included. Apply only to Claude's isolated
integration tree; verify the matching backend contracts there. No commit, public
push, deployment, live driver data mutation or production migration is claimed.

Screenshots and browser receipts live under
`.config/astra-vecto-coordination/sprint-20260911/artifacts/`. These fixtures prove
bounded behavior, not live provider availability, auth acceptance or Postgres
concurrency. Main gateway liveness is separate from feature correctness.

## Current integrated session-boundary follow-up

The earlier integration instructions above are historical. The current combined
candidate is `astra/offer-faa-review-20260911`, checkpoint `21506372`, including
Claude's recovered backend work and the subsequent authenticated Offer/browser/
PostgreSQL evidence recorded in shared status. Preserve Claude's frozen worktree.

A focused follow-up on this candidate reproduced old decision counts and old
request errors in the first render after replacing a token for the same driver.
The chart owns local state, so clearing the provider's query cache did not prevent
that render. Results now carry the current local session identity and are compared
before display. The existing cancellation checks already reject late headers and
late JSON, even when the synthetic transport ignores AbortSignal; they remain
unchanged. No backend or shared chart contract changed.

All 30 Offer UI tests pass: 24 existing cases plus six current session-boundary
cases, including two reproduced first-render failures. Scoped lint, client
TypeScript and whitespace checks pass. This follow-up changes no layout. The
existing tooltip correction already provides an 8 px gap at 320 px; its saved
browser receipt matches the pre-follow-up chart source exactly. Shared status
contains the stable focused patch, latest build and runtime attestation.
