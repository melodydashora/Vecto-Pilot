# Removed: one-off `lattitude` alias patch in analyze-offer.js (2026-08-14)

**What was removed** (lived at `server/api/hooks/analyze-offer.js` ~200–206,
landed 2026-07-03):

```js
// 2026-07-03: "lattitude" (double-t) alias — Melody's live Shortcut sent this
// misspelling and the mismatch silently dropped GPS to null for months
// (docs/architecture/SIRI_SHORTCUT_ANALYZE.md finding 1 — now Part 6 item 3 after the 2026-08-17 rewrite). Accept it loudly.
if (latitude == null && req.body.lattitude != null) {
  latitude = parseFloat(req.body.lattitude);
  console.warn('[HOOKS] Body field "lattitude" (misspelled) accepted as latitude — update the Shortcut key name');
}
```

**Why**: superseded, not deleted-as-wrong. Melody (2026-08-14, verbatim intent):
"I don't want you to have to tell end users to spell latitude correctly."
Drivers hand-build their Shortcuts; one special-cased typo doesn't scale to a
user base. The patch generalized into a deterministic alias table —
`server/lib/offers/normalize-offer-body.js` (`lattitude` remains an enumerated
variant there, alongside lat/lng/lon/long, case variants, `token`, etc.).
Same fail-loud contract: every remap warn-logged; exact canonical keys always
win over aliases; lookup-table only, never fuzzy matching (determinism rule).

**Coverage**: `tests/offers/normalize-offer-body.test.js` (9 tests, includes
the original `lattitude→latitude` case).
