# Previous Strategy during regeneration — September 11, 2026

## Result and provenance

After a completed Strategy, refreshing GPS keeps the earlier advice readable while
the current snapshot is prepared. It appears as **Previous strategy**, with its
original city and stable **Last received** time. Current GPS, generation and
persisted Briefing failures retain their own visible status and retry controls.
New completed advice replaces the historical record.

This implements the in-memory display scope of existing todo 34. Melody's original
short-trip request is preserved in the September 10 Windows Astra transcript
`20260910-1001UTC-6-Windows PowerShell-Astra.txt`, lines 3887–3889, as relayed by
Desktop's independent review. The preceding design is
`2026-09-10-last-completed-strategy-design.md`; its cold-reopen proposal remains
separate from this implementation. Codex/Astra integrated this work on isolated
branch `astra/offer-faa-review-20260911`, based on `8d0d4822`.

## Completion and display contract

- Only nonblank text from an owned, matching requested/returned snapshot with
  `status: ok`, `briefingStatus: complete`, and no explicit stale marker can
  replace history. Zero venues is a valid completed response. `pending_blocks`
  can supply current immediate advice after complete Briefing; it cannot replace
  the completed historical record.
- History is a separate in-memory value in the existing CoPilotProvider. It never
  supplies the current map, venue list, request arguments, feedback or action IDs.
  Advice is rendered as React text with simple bold emphasis; inherited HTML and
  links create no active elements. Current advice uses the same text renderer.
- The record captures source snapshot, owner, city, timezone and first client
  receipt time. This is **Last received**, not an invented server generation time.
  Display uses an explicit UTC timestamp. Identical same-snapshot completions do
  not reset it. Late metadata from that same snapshot may fill missing fields;
  new GPS context never replaces known historical metadata.
- Account replacement and token replacement hide the old record, snapshot and
  error details synchronously, before cleanup effects. Query responses are fenced
  after headers and body parsing. Query keys include owner and an in-memory
  session revision; bearer tokens remain outside cache keys and history records.
- Red Briefing/error retry remains above passive history. Authentication failures
  suppress history. GPS loss and current failure do not show the waiting message.

## Current action isolation

The existing venue-modal opening-scope guard already closes an old modal when
snapshot, ranking, owner or token changes. Actual StrategyPage tests now include
the reported S1/R1 modal to S2/R2 GPS transition, without unmounting the page.
No live selection bug is claimed: the inspected positive selection setter has no
active caller.

Dwell observers now reset on snapshot, owner and token changes as well as venue
and ranking changes. Disconnected observers ignore queued callbacks, so a new
card cannot inherit dwell time from a previous scope. The venue-feedback cache
write uses the existing query prefix plus its ranking check, reaching the newly
session-qualified current cache without replacing another ranking or snapshot.

## Focused verification

- 24 actual CoPilotProvider/query-cache tests plus 4 preserved Briefing retry tests.
- 7 actual StrategyPage history tests; 14 actual-page venue/modal/dwell tests.
- 17 venue-feedback hook/modal/cache tests, including the qualified-cache update.
- Client TypeScript, scoped production ESLint, diff whitespace check and Vite
  production build pass. The running candidate serves the exact built HTML bytes.

Meaningful failures were captured before fixing history retention, late source
metadata, synchronous old-account error details, three dwell boundary cases and
the qualified venue-cache update. Browser acceptance and immutable patch/runtime
receipts are maintained in ignored sprint coordination artifacts. Those receipts
distinguish synthetic HTTP responses from earlier real candidate/PostgreSQL checks.

Actual built-client browser acceptance passed at 03:47 UTC: completed A to pending
B to completed B, plus a separate current Briefing failure, preserved source city
and receipt time and exposed no historical controls. All six 320/390 px card and
error-overlay layout checks passed with zero page errors or attempted writes.
Root inspected the screenshots. The browser used synthetic resolved GPS; missing
GPS is covered by the actual-page tests. An initial incomplete synthetic auth
fixture was correctly rejected; that receipt remains alongside the passing run.
No additional active exact-key cache consumer was found in a focused integration
read after the provider key change.

## Limits

Retention lasts for the mounted provider, including route changes and a normal
background/foreground return. Cold reload does not restore historical text; this
change introduces no storage envelope, TTL, historical fetch or new pipeline
input. Todo 23's reopen-freshness policy remains open. No production deployment,
migration, real driver GPS or new provider call was used for this feature.
