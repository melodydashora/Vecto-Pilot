# Verification: 2026-04-16 Hallucination Fixes (H-1/H-2/H-3) + beyond_deadhead

**Date:** 2026-04-16
**Method:** One-off verification script (`scripts/verify-hallucination-fixes.mjs`) against live dev DB + server restart
**Fixture:** Snapshot `fb3c383e` (Frisco, TX, America/Chicago)
**LLM credits burned:** 0 (prompt-level verification, no model call)

## Results

| Fix | Expected | Actual | Status |
|-----|----------|--------|--------|
| **H-1:** No numeric attendance in prompt | Event lines show qualitative labels only (`[high attendance]`, `[low attendance]`), no `~X expected` | All 10 sampled event lines clean — zero numeric interpolations. Regex `~?\d{1,3}(,\d{3})+\s*(expected\|attendance)` returned 0 hits | **PASS** |
| **H-2:** Date gate — only Apr 16 events | All events have `event_start_date = 2026-04-16` | 44 events loaded, all dated 2026-04-16. Dallas Pulse (Apr 17, deactivated) absent | **PASS** |
| **H-3:** Capacity ceiling — real data used | Events at seeded venues use `venue_capacity * demand_pct` instead of flat heuristic | 23/44 events matched to real venue capacity. E.g., Dickies Arena: 14,000 cap × 0.85 = 11,900 (not flat 18,000 heuristic) | **PASS** |
| **beyond_deadhead:** Four-hop chain | `beyondDeadhead` and `distanceFromHomeMi` present on ranking_candidates | 10 candidates verified in DB — all have `beyond_deadhead: false` and `distance_from_home_mi: 3.1-6.0` (driver is 3-6mi from Frisco venues, within 15mi default) | **PASS** |

## Detailed Evidence

### H-1: Prompt injection cleanliness
Sample event lines that would be injected into the strategist prompt:
```
- NCAA Women's Gymnastics Championships - Semi-Finals (sports) [high attendance]
- Nostalgix Live DJ Set (nightlife)
- Charles McBee Stand-Up Comedy (comedy)
- Stephen Marley Concert Tour 2026 (concert) [high attendance]
- Cirque du Soleil - Echo (theater) [high attendance]
- Frisco Chamber's Candidate Forum (community) [low attendance]
```
No `~5,000 expected`, no `~18,000 expected`, no numeric capacity. Only qualitative `[high/low attendance]` labels survive. The `const capacity = ''` fix at `consolidator.js:1134` is working.

### H-2: Date gate
```
Date gate: today = 2026-04-16 (America/Chicago)
Events loaded: 44 — all event_start_date = 2026-04-16
Dallas Pulse (Apr 17): NOT in result set (is_active=false, deactivation_reason populated)
```

### H-3: Capacity ceiling
23 events matched to real venue capacity from the 30-venue seed:
```
Dickies Arena:        cap=14,000, high demand → est=11,900 (was flat 18,000)
AAC:                  cap=19,200, high demand → est=16,320 (was flat 18,000)
Riders Field:         cap=10,216, medium demand → est=5,108 (was flat 15,000)
House of Blues:       cap=2,200,  high demand → est=1,870 (was flat 10,000)
Dallas Comedy Club:   cap=400,   low demand → est=60 (was flat 350)
Kessler Theater:      cap=900,   medium demand → est=450 (was flat 2,000)
Bass Performance Hall: cap=4,200, medium demand → est=2,100 (was flat 2,000)
```

### beyond_deadhead: Four-hop chain
```
ranking_candidates DB rows:
  Omni Frisco Hotel:     beyondDeadhead=false, distFromHome=3.1mi
  Legacy Hall:           beyondDeadhead=false, distFromHome=4.3mi
  Comerica Center:       beyondDeadhead=false, distFromHome=3.8mi
  Riders Field:          beyondDeadhead=false, distFromHome=3.9mi
  Omni PGA Frisco:       beyondDeadhead=false, distFromHome=6.0mi
```
All within 15mi default deadhead — no amber badges expected for this location. The flag would trigger for venues >15mi from the driver's home.

## How to re-run this verification

```bash
node scripts/verify-hallucination-fixes.mjs
```

Update `SNAPSHOT_ID` in the script to use a current snapshot. The script:
1. Loads a snapshot from the DB
2. Queries today's events with the venue_catalog LEFT JOIN
3. Checks date gating (all events must match today in driver TZ)
4. Checks capacity ceiling (events with real venue capacity vs heuristic)
5. Simulates prompt injection and greps for numeric leaks
6. Reports PASS/FAIL per fix

No LLM credits consumed — tests at the data/prompt layer only.
