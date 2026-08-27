# Offer Analyzer — real-card fixture corpus

Real offer cards (OCR text as the phone actually sent it, or a description of the
screenshot) used by `tests/offers/*.test.js` and `scripts/offer-analyzer-smoke.mjs`.
Started 2026-08-26 from the 2026-08-24 delivery brief (Cowork session, Melody's Samsung,
MacroDroid text lane). **Bench method:** real cards × runs, scored against the rules engine.

| Id | Card | Source | Expected (DEFAULT_RULESET) |
|---|---|---|---|
| D1 | Delivery Exclusive · $7.50 · "Includes expected tip" · 19 min (4.6 mi) total | 2026-08-24 12:55 CT, clean OCR | $1.63/mi, $24/hr → **REJECT delivery_low_hr** (1.63 ≥ 1.50 passes, 24 < 25 fails) |
| D2 | Same card, **decimal-dropped OCR "$750"** — verbatim MacroDroid System Log array | 2026-08-24 12:55:47 live incident | **NO DATA implausible_parse** — must never be ACCEPT (live behavior it replaces: ACCEPT $163.04/mi, $2368/hr) |
| R1 | Comfort · $13.25 · "$33.13/active hr" · 5.00★ Verified · 13 min (5.5 mi) + 10 mins (3.8 mi) | 2026-08-23 card | $1.42/mi, 9.3 mi, 23 min → premium **ACCEPT** (unchanged by v3.2) |
| R2 | UberX Priority · $8.54 · 4.92 · Verified · 4 min (1.9 mi) + 10 min (4.2 mi) | canonical A/B case (todo #43, 2026-08-14) | $1.40/mi, 6.1 mi → standard ACCEPT at defaults |

Rules for adding a card: paste the OCR **verbatim** (keep MacroDroid's `[n]:` flattening —
the parser reads it as-is), note the source/date, and state the expected verdict under
`DEFAULT_RULESET` and, if relevant, under the driver's real ruleset.
