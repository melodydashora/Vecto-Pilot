# Offer workflow comment preservation — 2026-09-11

Provenance: Replit Codex/Astra. The recovered Offer workflow separates outcome
editing from the recent list. Drafts now require explicit Save, versioned saves
return canonical data, full-period stats replace latest-list headline totals,
and the list captures the auth-context token with a driver-scoped cache key.
The following comment text from main `6a97c058` was replaced with that behavior
or moved out during extraction. This is historical context, not current guidance.

```text
// client/src/components/offer-analyzer/OffersCard.tsx
// 2026-07-03 (todo #10): Live offer history + outcome capture (design §7-§8).
// Shows the analyzer's recommendation per offer ("our call") and lets the driver
// record what actually happened ("your call") — the disagreements feed the coach.
// Refetches on the offer_analyzed SSE event; earnings unlock on Accepted/Completed.
// Row shape is the FLAT offer_intelligence LEFT JOIN offer_outcomes row that
// GET /api/offer-analyzer/offers returns (server/api/offer-analyzer/index.js).
// v3.2 (2026-08-26): lane + provenance facts from parsed_data_json (server GET /offers)
// LEFT JOINed outcome columns (flat, null when no outcome recorded)
// Mirrors GET /api/offer-analyzer/offers stats (server/api/offer-analyzer/index.js).
/** pg can return numerics as strings depending on the column type — coerce once. */
// 2026-08-26: an implausible parse (the OCR read "$7.50" as "$750" — live 2026-08-24) is
// stored as NO DATA with reason_kind 'implausible_parse'. It must never wear the green
// ACCEPT treatment; amber says "we read numbers we could not trust — decide manually".
// 2026-07-03 review fix: "Followed the call" used to store NULL, which conflated
// "unrecorded" with "followed", blocked earnings capture for followed ACCEPTs,
// and excluded the most common outcome from every stat. It now resolves to the
// concrete decision implied by our recommendation (ACCEPT→Accepted, REJECT→Rejected);
// unrecorded offers show a placeholder instead of a pre-selected answer.
// No outcome recorded → placeholder, never a pre-selected answer.
// Re-sync the earnings draft when a refetch brings back the saved outcome.
// Keyed to the joined outcome values, not the whole row object identity.
// "Followed the call" resolves to the concrete decision our recommendation
// implies — it is a real outcome, not a null.
// The upsert overwrites every column. Earnings carry over only between the
// taken states (Accepted ↔ Completed); switching to Rejected/Cancelled
// clears them — otherwise the realized total stays inflated with dollars
// from a ride that didn't happen, with no UI path to remove them.
/* key: re-mount Radix Select when a refetch changes the recorded outcome */
// The default queryClient queryFn sends no auth header and force-logs-out on
// 401 — always pass an explicit queryFn with getAuthHeader().
```

The recovered September 10 source also contained this coordination comment,
now replaced because this sprint explicitly assigns OffersCard to Replit Astra:

```text
// The existing recent-list query/auth/SSE wiring remains the coordinated CLI scope.
```
