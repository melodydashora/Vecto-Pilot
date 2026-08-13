# OFFER_RULESET_V3_DESIGN.md — Per-Driver, DB-Backed, UI-Editable Offer Rules

> **Status:** APPROVED direction (Melody, 2026-07-03) — full verbatim spec scope,
> per-driver rules, typed-forms UI, vision-first, zero hardcoded locations.
> **Provenance:** Joint — Melody's decisions (scope, semantics, vision-first,
> no-hardcoded-locations, outcome card) + Claude's design against workflow-verified
> ground truth (8-agent sweep, 2026-07-03). Supersedes the storage/API sections of
> `OFFER_ANALYZER_EDITOR_PLAN.md` (2026-06-01, now partially stale); the three-decision
> ML model (§0 there) and outcome-capture design are carried forward unchanged.
> **Spec input:** `docs/OFFER_ANALYZER_DRIVER_RULESET.md` (Melody-authored, verbatim).
> **Ground truth:** see workflow findings summarized in §9.

---

## §1 · Melody's decisions (2026-07-03, in-session)

1. **Scope: full verbatim spec** — every rule kind in her LOGISTICAL DISPATCH AUDITOR
   spec becomes representable and editable, not just the existing v2 knobs.
2. **Per-driver rules** — each signed-in driver edits their own; requests without a
   token get `DEFAULT_RULESET` (zero behavior change for un-migrated devices).
3. **Typed-forms editor** — sliders/switches/ladder rows; no raw JSON on a phone.
4. **Zero hardcoded locations** — Fort Worth/Denton/Garland/US-380/home base are HER
   DATA entered via place search (Google `place_id` identity), never code constants.
5. **Vision-first** — the Shortcut sends ONLY the screenshot (no OCR extraction, no
   GPS): "the address is on the offer … we don't have to overthink even getting
   current location." Pickup distance/time from the driver's position is printed on
   the offer card itself.
6. **Full extraction moves to Phase 2** — "we will need to do the full extraction for
   the deeper analyzer … this will tell us where pings and patterns happen." Phase 2
   geocodes the extracted addresses → the pings/patterns dataset.
7. **Outcome card** — offers listed with our recommendation; driver can record what
   they actually did ("if I get a reject — I can tell our system I accepted it") to
   feed the coach.

## §2 · Architecture: one ruleset, two enforcement lanes

The v2 invariant is preserved and extended: **one config object is the single source**
for everything the analyzer does.

```
                    offer_rulesets.config (jsonb, v3)
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
 buildPhase1Prompt     evaluateDeterministic   buildPhase2Prompt
 (vision-judgment      (numeric ground truth:  (deep analyzer: SAME
  lane: road types,     floors, ladders,        rules — replaces the
  on-the-way, "…",      pickup/time limits,     hardcoded English copy
  stops, round trip,    ARP fallback)           in analyze-offer.js)
  avoid-place labels)
```

- **Vision-judgment lane** (prompt-rendered): rules whose signal exists only in the
  screenshot — road-type safety, "On the way" filter, "…" deadhead-reduction marker,
  Verified badge, multiple stops, round trip, avoid-place geography (by label),
  commercial staging. The model is TOLD what to look for by the rendered prompt, so
  editing a rule in the UI literally rewrites the model's instructions.
- **Deterministic lane** (code-evaluated): everything numeric — tier floors and
  ladders, per-minute conjunctions, pickup limits, total-time limit, acceptance-rate
  protection. Runs on numbers the vision model extracts (Phase 1 JSON) or the OCR
  pre-parse when text is present. Code is the authority on arithmetic.
- **Phase-2 deterministic geo audit**: after INSERT, geocode pickup/dropoff
  (`place_id` + 6-decimal coords) and re-evaluate geography rules deterministically;
  store the audit + a disagreement flag. Geography is enforced by vision in the
  3-second window and *verified* by geometry minutes later — every disagreement is
  training data.

## §3 · Ruleset schema v3 (`RULESET_SCHEMA_VERSION = 3`)

All new keys are **render-inert at defaults** (null/false/[]), so
`buildPhase1Prompt(tier, DEFAULT_RULESET)` stays byte-identical to the v2 pins in
`tests/offers/rules-engine-parity.test.js` and un-migrated behavior is unchanged.

```jsonc
{
  "schema_version": 3,
  "basis": "full_ride",
  "global": {
    "rating_floor": 4.85,            // Melody's saved row: 4.90
    "require_verified": true,
    "pickup_limits": null,           // { max_miles: 3, max_minutes: 8 }  (spec: Pickup Limits)
    "time_limit": null,              // { max_total_minutes: 20, unless: { min_per_mile: 2.00, min_per_minute: 1.00 } }
    "acceptance_rate_protection": null, // { min_per_total_mile: 1.00 } → ACCEPT (FALLBACK), after ladder fails,
                                        // only when no safety/geography/time rule fired  (spec: ARP)
    "auto_reject": null,             // { multiple_stops: true, round_trip: true } — vision lane
    "safety_road_types": false,      // true → vision lane: reject dirt/gravel/unpaved/ranch/oil-field/
                                     // off-road/flooded/inaccessible-gated/construction-closed access
    "commercial_staging": false,     // true → vision lane: do not penalize short trips near commercial hubs
    "notices": null                  // { verified_rider, on_the_way_filter, deadhead_reduction } — mention-if-present
  },
  "share": { "auto_reject": true },
  "tiers": {
    "standard": { "floor_per_mile": 0.90, "floor_per_minute": null, "accept_ladder": [ /* v2 rungs; rungs may
                   now carry min_per_minute for the spec's "$2/mi AND $1/min" conjunctions */ ] },
    "premium":  { /* v2 unchanged */ },
    "comfort":  null,                // optional split-outs; when set, classifyTier routes Comfort here
    "xl":       null                 // when set, routes UberXL/Lyft XL/... here (spec: XL $2.00/mi ~$1/min)
  },
  "tier_products": null,             // { comfort: ["Comfort", ...], xl: ["UberXL", ...] } — overrides membership
  "geo": { /* v2 unchanged (home_city/other_city/airport overrides) */ },
  "avoid": [                         // NOW CONSUMED (was inert in v2). 100% user-entered places:
    {
      "place_id": "ChIJ…",          // Google identity (determinism doctrine)
      "label": "Fort Worth",         // display + prompt rendering
      "lat": 32.755488, "lng": -97.330766,   // 6-decimal, from Places — never model-generated
      "mode": "heads_toward",        // "destination_in" | "heads_toward" | "north_of" | "south_of"
      "radius_mi": 6,                // destination_in: inside this radius of the anchor
      "corridor_deg": 30,            // heads_toward: pickup→dropoff bearing within ±deg of pickup→anchor
      "min_trip_mi": 8,              // heads_toward: ignore short hops
      "enabled": true
    }
  ],
  "home": null                       // { deadhead_only: true, mention_threshold_min: 20 } — anchors to
                                     // driver_profiles.home_lat/home_lng (already geocoded at signup);
                                     // spec: home used ONLY for post-drop deadhead estimation
}
```

**Spec → v3 mapping (complete):** rate targets → `tiers.{standard,comfort,xl}` floors
(+ per-rung `min_per_minute`); rating 4.90 → `global.rating_floor`; Verified →
`require_verified` + `notices.verified_rider`; Share/Multiple Stops/Round Trip →
`share.auto_reject` + `global.auto_reject`; geography rejects → `avoid[]` (user
places, modes); north-of-US-380 → `avoid[]` with `mode:"north_of"` anchored to any
user-picked point on the corridor; time limits → `global.time_limit`; pickup limits →
`global.pickup_limits`; ARP → `global.acceptance_rate_protection`; safety road types →
`global.safety_road_types`; commercial staging → `global.commercial_staging`;
On-the-way / "…" marker → `notices`; home/deadhead → `home` + profile home;
Vision>OCR priority → pipeline behavior (vision input primary; OCR pre-parse feeds
the deterministic lane when text exists); decision priority order → evaluator gate
order (safety[vision] → rating → geography[vision/audit] → pickup → floors/ladder →
time → ARP); output format/notifications → Phase-1 response builder + `notices`.

`migrateRuleset(config)`: v1/v2 → v3 by filling absent keys with inert defaults;
called on every read; saved configs are always written back at v3.

## §4 · Identity bridge (shortcut token)

- `driver_profiles` additive columns: `shortcut_token varchar(43) UNIQUE`
  (`vp_` + 40 base62 chars ≈ 238 bits), `shortcut_token_created_at timestamptz`,
  `shortcut_device_label text`.
- Resolution at ingest (`analyze-offer.js`): `X-Shortcut-Token` header, else
  `shortcut_token` body/form field (Shortcuts headers are fiddly; both accepted).
  Valid token → `user_id` + their ruleset. No/invalid token → `user_id = null` +
  `DEFAULT_RULESET` (invalid logs a warn — fail loud, respond anyway: a driver
  mid-shift always gets an answer).
- Spoofing posture: rules are keyed to the UNGUESSABLE token, never to the
  attacker-suppliable `device_id`. Spoofing a device_id yields only defaults.

## §5 · Storage & provenance (additive migrations only)

`migrations/20260703_offer_rulesets_outcomes.sql` (idempotent, template =
`20260505_coach_offer_decisions.sql`; `shared/schema.js` updated in lockstep):

- **`offer_rulesets`**: `id uuid PK`, `user_id uuid NOT NULL UNIQUE REFERENCES
  users(user_id) ON DELETE RESTRICT` (mirrors `driver_profiles` — users rows are
  never deleted), `version int NOT NULL DEFAULT 1` (bumps each save),
  `config jsonb NOT NULL`, `config_hash text NOT NULL` (sha256 of canonical JSON),
  `created_at/updated_at timestamptz`.
- **`offer_outcomes`** (plan-doc §4.1 carried forward): `id uuid PK`, `user_id uuid
  NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT` (changed from the plan's
  CASCADE — preserve ML data), `offer_intelligence_id uuid REFERENCES
  offer_intelligence(id) ON DELETE SET NULL`, `driver_decision text CHECK IN
  ('Accepted','Rejected','Cancelled','Completed')`, `driver_reasoning text`, earnings
  (`actual_pay`, `reimbursements`, `extras`, `other` double precision;
  `total_earned` GENERATED STORED sum), `outcome_source text NOT NULL DEFAULT
  'web_app'`, timestamps; unique partial index on `offer_intelligence_id`.
- **`offer_intelligence`** additive: `ruleset_version int`, `ruleset_hash text`
  (NULL = defaults were applied — degradation is visible, not silent).
- `driver_profiles` token columns (§4).

## §6 · Hot path changes (`analyze-offer.js`)

1. **Ruleset load**: `server/lib/offers/ruleset-store.js` —
   `resolveRuleset({token})` → token → `driver_profiles.user_id` →
   `offer_rulesets.config` → migrate → `{ruleset, userId, version, hash}`.
   In-process cache TTL 15s (Cloud Run multi-instance ⇒ short TTL; PUT busts local
   entry; measured p50 5.3s makes a ~20ms read noise anyway).
   **Fail posture (named conflict, resolved):** strict Zod validation at WRITE time
   (invalid configs cannot persist — the fail-loud gate), fail-open to
   `DEFAULT_RULESET` with `console.error` at READ time (the Siri path always
   answers; `ruleset_hash NULL` stamps the degradation). Presented to Melody in the
   session report.
2. **Bug fixes (pre-existing, load-bearing):**
   - TDZ crash: `const terseReason` (local, :366) shadows the module function —
     the deterministic fallback 500s instead of answering. Rename the local.
   - Deterministic fallback fires on **model-call failure and timeout**, not just
     JSON-parse failure ("rules always answer" — spec's 3-second Match reality).
   - Phase-1 `callModel` wrapped in a 20s race (under the ~30s Shortcut kill).
   - `lattitude` body alias accepted with warn log (live GPS-drop bug; GPS is now
     optional anyway, but old installs shouldn't silently lose data).
3. **Provenance**: INSERT sets `user_id`, `ruleset_version`, `ruleset_hash`.
4. **Phase 2 same-ruleset prompt**: `buildPhase2Prompt(ruleset, context)` in
   rules-engine.js replaces the hardcoded English ladder in
   `buildPhase2SystemPrompt` (drift bug; dead `location` param deleted).
5. **Phase-2 full extraction + geo audit** (after INSERT, non-fatal try/catch,
   UPDATE by id): geocode `pickup_address`/`dropoff_address` via
   `geocodeEventAddress` (returns `place_id`; round to 6 decimals) → fill
   `pickup_lat/lng`, `dropoff_lat/lng`, `geocoded_at` (the waiting columns) →
   deterministic geography audit (haversine radius / new bearing util / lat
   compare) → append `{geo_audit, rules_disagreement}` into `parsed_data_json`.
6. **`/offer-history`**: keep the response shape, ADD `analyzer_accepted` /
   `driver_accepted` / `outcomes` fields (fixes the §0 conflation bug additively).

## §7 · API (new router `server/api/offer-analyzer/index.js`, mounted at
`/api/offer-analyzer`, all `requireAuth`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/rules` | my ruleset (migrated to v3) or DEFAULT; `{config, version, hash, is_default}` |
| PUT | `/rules` | Zod-validate → upsert → `version++` → recompute hash → bust cache |
| GET | `/shortcut-token` | get-or-create `{token, created_at, device_label}` |
| POST | `/shortcut-token/regenerate` | rotate (revoke lost device) |
| GET | `/offers?limit=` | my offers (`user_id = me`) LEFT JOIN outcomes + separated stats |
| POST | `/offers/:id/outcome` | upsert outcome (driver_decision, reasoning, earnings) |
| GET | `/places/search?q=&near=` | place picker for avoid-list/anchors — wraps `searchPlaceWithTextSearch` (place_id + 6-dec coords) |

## §8 · Page (`/co-pilot/offer-analyzer`, menu "Offer Analyzer", Gauge icon)

SettingsPage conventions: Card sections, react-hook-form + zodResolver (documented
`as unknown as Resolver<T>` cast), `form.reset` on load, explicit **sticky Save**
(repo has no autosave precedent), `useToast`, container `max-w-2xl`, `pb-24`,
sticky bar `bottom-20`. API routes added to `constants/apiRoutes.ts`.

```
OfferAnalyzerPage
├── SetupCard         — iCloud link (docs/architecture/SIRI_SHORTCUT_ANALYZE.md),
│                       accessibility triggers, token display/copy/regenerate, device label
├── RulesEditor
│   ├── RateTargetsCard    — per-tier floors ($/mi, $/min) + ladder rows (net-new repeatable rows)
│   ├── GatesCard          — rating floor slider (step .01), verified switch, share/stops/round-trip switches
│   ├── LimitsCard         — pickup limits (mi/min), time limit + unless-conjunction, ARP threshold
│   ├── GeographyCard      — avoid-places list: search (GET /places/search) → pick → mode select
│   │                        (in-city / heads-toward / north-of / south-of) + per-rule enable
│   └── VisionRulesCard    — road-type safety, commercial staging, notices toggles
└── OffersCard        — SSE-live list (subscribeSSE('/events/offers','offer_analyzed')),
                        recommendation badge + "what I actually did" control + earnings form,
                        stats: analyzed / we-said-accept / you-accepted / realized $
```

## §9 · Ground-truth constraints this design obeys (workflow, 2026-07-03)

- Parity pins are byte-identical prompt snapshots → v3 keys render **nothing** at
  defaults; pins stay green un-rebaselined.
- Real Phase-1 latency p50 5324ms / p95 6851ms (n=448) vs the "<2s" comment — the
  ruleset DB read is noise; the latency lever is `thinkingLevel: HIGH` (registry-
  documented step-down), tracked as a follow-up measurement, not changed blind.
- Decision vocabulary is `ACCEPT|REJECT|NO DATA` (schema.js:1734 comment is stale —
  fix comment; Zod enums use the real values).
- `avoid[]`/geo/share flags were inert in v2 — v3 WIRES them (UI must never edit a
  knob nothing consumes; that list is now empty).
- Migrations: idempotent SQL, `npm run db:migrate` re-runs all files; dev/prod by
  `DATABASE_URL` only; prod application needs explicit approval.
- Tier names were hardcoded in 5 places → tier iteration becomes
  `Object.keys(ruleset.tiers)` with null-tier skips.
- No `useMutation`, no `useFieldArray` precedents client-side — plain fetch
  handlers; ladder rows are net-new UI.
- jest ESM (`npm run test:unit`); tests in `tests/offers/`.

## §10 · Non-goals (unchanged from plan doc)

Model roles stay `OFFER_ANALYZER`/`OFFER_ANALYZER_DEEP` (Gemini-pinned, vision);
no multi-device tokens; device_id input contract stays (augmented, not replaced);
OfferMap deferred (needs accumulated geocoded Phase-2 data first — it now builds
itself from the pings dataset).
