# Offer Analyzer components

`OfferAnalyzerPage.tsx` owns the rules form and explicit Save Rules flow.
Current source reference: [Offer Analyzer](../../../../docs/architecture/OFFER_ANALYZER.md).
The [canonical lexicon](../../../../LEXICON.md) names the feature **Offer Analyzer**;
**offers** are the proposals and saved records it analyzes and tracks. Daily Offers
is a record-list section within the feature.

- `RateTargetsCard.tsx`: shows economic groups applicable to confirmed selected
  services using `shared/driver-services.js`, the same routing used by evaluation.
  Service identity differs from vehicle eligibility and economic tier. Legacy null
  selection is visibly unverified; hidden cards do not delete saved thresholds.
- `SetupCard.tsx`: opens signed-in Offer Analyzer capture and produces a
  token-free Android browser launcher; existing native iPhone automation remains
  separately labeled legacy. A browser launcher still needs screenshot selection.

- `OffersCard.tsx`: all analyzed offers for the selected local day; driver-scoped query
  and SSE/focus refresh. Failed background refreshes retain cached rows and open
  drafts. Older offers with unsaved changes remain until Save or Cancel. Changing
  accounts remounts the editor boundary and cancels prior requests.
- `OfferOutcomeRow.tsx`: draft decisions, optional reason and earnings; explicit save,
  revision conflict recovery, confirmed compact summary and Edit. Other/error is a
  distinct outcome. Offered pay is a draft default only for a new outcome; saved
  zero and unknown values are preserved. Accepted includes completed for reporting.
- `OffersDecisionChart.tsx`: independently loads complete selected-day or rolling 7/30/90-day counts.
  Offer Analyzer recommendations and driver decisions are labeled separately. Only saved,
  driver-reported monetary entries count as earnings; rejected offers are not savings.
  Inconsistent count partitions or interval bounds show an error. Date labels use
  the GPS-resolved timezone through the shared adapter, with original instants in
  `time` elements; a missing timezone leaves local labels unresolved.
  Counts and errors are bound to the current authenticated session. Replacing a
  token for the same driver hides the old result before effect cleanup; delayed
  responses cannot restore it.
  Background updates retain the current session/period's mounted chart and label
  refresh failures as last loaded counts. Date/period/session changes and rejected
  authorization clear prior counts. The page keeps its offer-update callback
  stable so each SSE reconnect handshake cannot cause another reconnect.

The current source includes outcome revision/Other handling, canonical saved/conflict
responses, reversible removal and complete-period stats. Deployment/migration state is
not established by this README. The [September frontend handoff](../../../../docs/coordination/2026-09-11-offer-faa-frontend-handoff.md)
is historical evidence. Offered pay is never implicitly submitted by a dropdown change,
and a successful status without a complete saved row is an error.

Synthetic DOM tests exercise the real feature components while substituting the
Radix select and chart rendering primitives. The September 11 browser receipt
separately exercises real Radix/Recharts and CSS with intercepted synthetic data;
neither is proof of provider login, live database concurrency, or deployment.
