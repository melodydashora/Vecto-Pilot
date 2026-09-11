# Offer Analyzer components

`OfferAnalyzerPage.tsx` owns the existing rules form. SetupCard and the six rules
cards keep their current responsibilities and explicit Save Rules flow.

- `OffersCard.tsx`: latest 25 analyzed offers across all dates; driver-scoped query
  and SSE/focus refresh. Failed background refreshes retain cached rows and open
  drafts. Older offers with unsaved changes remain until Save or Cancel. Changing
  accounts remounts the editor boundary and cancels prior requests.
- `OfferOutcomeRow.tsx`: draft decisions, optional reason and earnings; explicit save,
  revision conflict recovery, confirmed compact summary and Edit. Other/error is a
  distinct outcome. Offered pay is a draft default only for a new outcome; saved
  zero and unknown values are preserved. Accepted includes completed for reporting.
- `OffersDecisionChart.tsx`: independently loads complete rolling 7/30/90-day counts.
  Analyzer recommendations and driver decisions are labeled separately. Only saved,
  driver-reported monetary entries count as earnings; rejected offers are not savings.
  Inconsistent count partitions or interval bounds show an error. Date labels use
  the GPS-resolved timezone through the shared adapter, with original instants in
  `time` elements; a missing timezone leaves local labels unresolved.
  Counts and errors are bound to the current authenticated session. Replacing a
  token for the same driver hides the old result before effect cleanup; delayed
  responses cannot restore it.

This UI requires the recovered September 10 outcome revision/Other migration,
canonical POST/conflict response, and complete-period stats endpoint. Backend
integration and rollout must accompany it; see the September 11 frontend handoff
in `docs/coordination/2026-09-11-offer-faa-frontend-handoff.md`. The older main API
does not provide these contracts. Offered pay is never implicitly submitted by a
dropdown change, and a successful status without a complete saved row is an error.

Synthetic DOM tests exercise the real feature components while substituting the
Radix select and chart rendering primitives. The September 11 browser receipt
separately exercises real Radix/Recharts and CSS with intercepted synthetic data;
neither is proof of provider login, live database concurrency, or deployment.
