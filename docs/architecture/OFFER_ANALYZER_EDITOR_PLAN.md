# OFFER_ANALYZER_EDITOR_PLAN.md — Per-User Offer Analyzer Page

> **Status:** PROPOSED — awaiting Melody's approval before Phase 1.
> **Created:** 2026-06-01 · **Owner:** Melody + Claude
> **Goal:** A per-user, real-time **Offer Analyzer** page in the hamburger menu that
> (1) lets the driver **edit the rules** the analyzer applies, (2) shows **offers
> analyzed** with a **driver-actual outcome + realized earnings** capture for
> future AI/ML, and (3) **maps** where rules were applied. Built incrementally,
> but architected as a complete system from the start.
>
> This doc is the contract. We build against it across sessions and keep it in
> zero-drift sync (CLAUDE.md §4). Verified facts cite `file:line`; the DB + code
> are ground truth (CLAUDE.md §2).

---

## §0 · CORE PRINCIPLE — THREE DISTINCT DECISIONS (do not conflate)

The entire ML value of this feature rests on keeping these **separate**:

| # | Concept | Source of truth (today) | Values |
|---|---------|--------------------------|--------|
| 1 | **Analyzer decision** — what the rules/AI recommended | `offer_intelligence.decision` (`schema.js:1731`, NOT NULL) | `ACCEPT`/`REJECT`/`UNKNOWN` |
| 2 | **Driver override** — driver disagreed with the AI in the moment | `offer_intelligence.user_override` (`schema.js:1741`) | `null`/`ACCEPT`/`REJECT` |
| 3 | **Driver actual outcome** — what the driver *actually did*, ground truth | _NEW_ `offer_outcomes.driver_decision` | `Accepted`/`Rejected`/`Cancelled`/`Completed` |

**Known conflation bug to fix:** `offer-history` (`analyze-offer.js:770`) reports
`accepted: history.filter(h => h.decision === 'ACCEPT')` — i.e. it counts the
**analyzer's** ACCEPTs and labels them "accepted," as if the driver took them.
The new stats must report analyzer-decision and driver-actual-outcome as separate
columns. (See §6 Phase 4.)

**The learning signal** = `(active ruleset) × (analyzer decision) × (driver decision) × (realized total_earned vs offered price)`.

---

## §1 · CURRENT PIPELINE (verified ground truth)

`POST /api/hooks/analyze-offer` — public, **device_id-based** (Siri Shortcuts
cannot send JWT; `analyze-offer.js:13`, `:1642`). Two-phase, tier-aware:

1. Input: multipart image **or** JSON body; one of text/image required else 400.
2. `parseOfferText()` regex pre-parse (`parse-offer-text.js`, <1ms, deterministic).
3. `tier = classifyTier(product_type)` → `share`/`standard`/`premium`; null→`standard` (`parse-offer-text.js:146`).
4. **share → short-circuit REJECT before any AI call** (`analyze-offer.js:298`).
5. Phase 1: `callModel('OFFER_ANALYZER', {system: PHASE1_PROMPTS[tier], …})` — synchronous, Siri-bound.
6. JSON parse in 3 tiers → direct → brace-slice → **deterministic code fallback** (`:349–432`) using `preParsed.per_mile`. No per_mile → `NO DATA`.
7. Response: `{ success, voice, notification, decision, response_time_ms, reason }` (`:462`).
8. Fire-and-forget Phase 2 (`OFFER_ANALYZER_DEEP`, 45s race) → enrich → **INSERT `offer_intelligence`** (`:623`) → `pg_notify('offer_analyzed')` (`:697`) → SSE to web app.

**Decision authority:** Phase 1 alone decides what the driver hears; Phase 2 only enriches the stored row.
**Numeric trust:** regex pre-parse > LLM math for all numeric fields.

### §1.1 · The rules today (verified)

Rules live in **two places that already drift** — the Gemini prompt
(`PHASE1_PROMPTS`, `analyze-offer.js:98–140`) and the JS fallback (`:367–432`):

- **Global gates** (non-share): reject if rating `< 4.85`; reject if "Verified" missing.
  - ⚠️ The "Verified" rule has **no** fallback equivalent; the fallback rating gate is **dead code** (reads `phase1Result.rider_rating` before assignment). Unifying the rule source (§2) fixes both.
- **share** (`Share`,`Lyft Shared`): auto-reject (`parse-offer-text.js:133`).
- **standard** floor **$0.90/mi**, ladder: `≥0.90 ≤20m`, `≥1.10 ≤25m`, `≥1.75 <30m`, `≥2.00 30–40m`, `≥2.00 >40m`; else reject.
- **premium** (`Comfort,VIP,Black,UberXL,UberXL Exclusive,Lyft XL,Lyft Lux,Lyft Black`; `parse-offer-text.js:129`) floor **$1.10/mi**, ladder: `≥1.10 ≤25m`, `≥1.40 ≤30m`, `≥1.75 ≤40m`, `≥2.00 >40m`; else reject.

### §1.2 · What already exists (reuse, do not rebuild)

- `offer_intelligence.user_id` — **nullable, NO FK, already indexed** (`schema.js:1660`, `:1804`). The user bridge column exists; the INSERT just never sets it (`:623`).
- `driver_lat`/`driver_lng`/`h3_index`/`coord_key` + spatial index (`:1704–1707`, `:1798`) → the map has data today.
- `pg_notify('offer_analyzed')` → SSE (`:697`) → realtime is wired; the page subscribes.
- `driver_profiles.concierge_share_token varchar(12) unique` (`:995`) → **precedent** for a per-user public-surface token (see §3).
- Client: Google Maps via `client/src/lib/maps/google-maps-loader.ts` + `client/src/components/strategy/StrategyMap.tsx` (pattern to mirror).
- Settings template: `client/src/pages/co-pilot/SettingsPage.tsx` (react-hook-form + Zod + shadcn/ui Cards). Hamburger: `client/src/components/HamburgerMenu.tsx` `MENU_ITEMS`. Routing: `client/src/routes.tsx` under `/co-pilot` + `ProtectedRoute`. Auth: `client/src/contexts/auth-context.tsx` `useAuth()` + `getAuthHeader()`.

---

## §2 · RULES ENGINE — unify prompt + fallback into one config

**Problem:** rules are duplicated (English prompt vs JS fallback) and drift.
**Solution:** one config object per user → *renders* the prompt **and** *drives* the
fallback. New module `server/lib/offers/rules-engine.js`:

```
export const DEFAULT_RULESET = { … current §1.1 values … };  // behavior-preserving
export function buildPhase1Prompt(tier, ruleset) { … render ladder → prompt text … }
export function evaluateDeterministic(tier, metrics, ruleset) { … same ladder in code … }
export function classifyTier(productType, ruleset) { … product→tier (ruleset-aware later) … }
```

**Config shape (`offer_rulesets.config` jsonb):**

```jsonc
{
  "schema_version": 1,
  "global": { "rating_floor": 4.85, "require_verified": true },
  "share":  { "auto_reject": true },
  "tiers": {
    "standard": {
      "floor_per_mile": 0.90,
      "accept_ladder": [
        { "min_per_mile": 0.90, "max_total_min": 20 },
        { "min_per_mile": 1.10, "max_total_min": 25 },
        { "min_per_mile": 1.75, "max_total_min": 30 },        // exclusive upper in current code
        { "min_per_mile": 2.00, "min_total_min": 30, "max_total_min": 40 },
        { "min_per_mile": 2.00, "min_total_min": 40 }
      ]
    },
    "premium": {
      "floor_per_mile": 1.10,
      "accept_ladder": [
        { "min_per_mile": 1.10, "max_total_min": 25 },
        { "min_per_mile": 1.40, "max_total_min": 30 },
        { "min_per_mile": 1.75, "max_total_min": 40 },
        { "min_per_mile": 2.00, "min_total_min": 40 }
      ]
    }
  }
}
```

**Invariants:** first-match-wins (ladder order preserved); `DEFAULT_RULESET` is
byte-equivalent in behavior to today; tier→product membership stays code-defined in
Phase 2 (editable later — §6 backlog). The endpoint loads the active ruleset by
resolved `user_id`; **no user / no custom rules → `DEFAULT_RULESET`** (zero behavior
change for un-migrated devices).

**Phase 2 (refactor) ships with a golden test**: replay a corpus of real offers
through old hardcoded path vs new `DEFAULT_RULESET` path and assert identical
decisions before any UI exists.

---

## §3 · IDENTITY BRIDGE — token → user_id (the per-user requirement)

The analyze endpoint is public; whatever the Shortcut sends is the **only** auth, so
it must be unguessable (determinism doctrine, CLAUDE.md §4). Mirror the existing
`concierge_share_token` pattern.

**`driver_profiles` additions:**
```
shortcut_token            varchar(32) unique   -- system-generated, e.g. "vp_" + base62(>=128 bits)
shortcut_token_created_at timestamptz
shortcut_device_label     text                 -- friendly, user-chosen ("Melody's iPhone"); display only
```

**Flow:** Shortcut sends `X-Shortcut-Token` (header) + `device_id` (body) →
endpoint resolves token → `user_id` → sets `offer_intelligence.user_id` on INSERT
(device_id still recorded). One token per user (covers both their iPhone and Android;
platform is only for setup instructions). Web page manages the token while
authenticated (Bearer). Regenerate = revoke a lost device.

> **OPEN DECISION (only one left):** confirm **system-assigned token** (recommended,
> above) vs letting the user type their own identifier. Recommendation: system-assigned
> + friendly label, because a public endpoint with a guessable id = anyone can
> read/overwrite your data or spoof your analysis. Optional defense-in-depth: also
> gate the endpoint behind the `VECTO_HOOK_TOKEN` shared secret the code already
> references (`analyze-offer.js:44`).

---

## §4 · DATA MODEL — migrations

### §4.1 · NEW table `offer_outcomes` (durable, per-user, survives the `offer_intelligence` truncate)

```
offer_outcomes (
  id                    uuid pk default gen_random_uuid(),
  user_id               uuid NOT NULL references users(user_id) on delete cascade,
  offer_intelligence_id uuid references offer_intelligence(id) on delete set null,  -- survives truncate

  -- §0 concept #3: driver actual outcome (NOT the analyzer decision)
  driver_decision  text,   -- 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed'  (UI starts as binary toggle)
  driver_reasoning text,   -- optional "why" (drives "AI was wrong here" learning)

  -- realized earnings (meaningful when Accepted/Completed). "extras" = perks + surges combined (per spec).
  actual_pay     double precision,
  reimbursements double precision,
  extras         double precision,
  other          double precision,
  total_earned   double precision
    GENERATED ALWAYS AS (
      coalesce(actual_pay,0)+coalesce(reimbursements,0)+coalesce(extras,0)+coalesce(other,0)
    ) STORED,            -- auto-total, deterministic, cannot drift

  outcome_source text NOT NULL default 'web_app',  -- 'web_app' | 'coach' | future
  created_at timestamptz NOT NULL default now(),
  updated_at timestamptz NOT NULL default now()
);
-- one outcome per analyzed offer:
create unique index uq_outcome_offer on offer_outcomes (offer_intelligence_id) where offer_intelligence_id is not null;
create index idx_outcome_user_created on offer_outcomes (user_id, created_at desc);
create index idx_outcome_decision on offer_outcomes (driver_decision) where driver_decision is not null;
```
*FK note:* mirrors `coach_offer_decisions` (`user_id → users cascade`). Revisit
`cascade` vs `restrict` if we want outcomes to survive user deletion for anonymized ML.

### §4.2 · NEW table `offer_rulesets`

```
offer_rulesets (
  id          uuid pk default gen_random_uuid(),
  user_id     uuid NOT NULL unique references users(user_id) on delete cascade,
  version     integer NOT NULL default 1,           -- bumps each save
  config      jsonb   NOT NULL,                      -- §2 shape
  config_hash text    NOT NULL,                      -- stable hash, stamped onto offers
  created_at  timestamptz NOT NULL default now(),
  updated_at  timestamptz NOT NULL default now()
);
```
(Optional Phase-3 `offer_ruleset_history` append-log for "did changing rules change outcomes?")

### §4.3 · `offer_intelligence` additions (provenance for ML)

```
ruleset_version integer   -- which version was active at analyze time
ruleset_hash    text      -- config_hash; reconstruct exact rules applied
-- user_id column already exists (:1660) — Phase 1 just populates it.
```

> All migrations are **additive** (new tables, nullable columns) — no drops/alters of
> existing data. Generated column + indexes via raw SQL in the migration (Drizzle
> `shared/schema.js` definitions added in lockstep). Prod migration requires explicit
> go-ahead (CLAUDE.md §7).

---

## §5 · API CONTRACTS

All authenticated (Bearer / `useAuth`) **except** the public analyze endpoint:

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/offer-analyzer/rules` | active ruleset for me (or `DEFAULT_RULESET`) |
| PUT | `/api/offer-analyzer/rules` | validate (Zod) → upsert → version++ → recompute hash (real-time save) |
| GET | `/api/offer-analyzer/offers?scope=today` | my offers (`offer_intelligence WHERE user_id=me` LEFT JOIN `offer_outcomes`), stats with analyzer-vs-actual **separated** |
| POST | `/api/offer-analyzer/offers/:offerId/outcome` | upsert `offer_outcomes` (driver_decision + earnings) |
| GET | `/api/offer-analyzer/shortcut-token` | my token (generate if absent) + device label |
| POST | `/api/offer-analyzer/shortcut-token/regenerate` | rotate token |
| — | SSE `offer_analyzed` (existing) | live-append new analyses for my user/device |

**`analyze-offer.js` changes:** resolve `X-Shortcut-Token` → user_id; load ruleset;
`buildPhase1Prompt(tier, ruleset)` + `evaluateDeterministic(tier, metrics, ruleset)`;
stamp `ruleset_version`/`ruleset_hash`; set `user_id`. Backward-compatible: no token →
null user_id + `DEFAULT_RULESET` (current behavior).

---

## §6 · FRONTEND — page & component tree

Route `/co-pilot/offer-analyzer` (under `ProtectedRoute`); `MENU_ITEMS` entry
(`Gauge` icon). TanStack Query for load; debounced PUT for live rule save; SSE for
new offers. shadcn/ui primitives only.

```
OfferAnalyzerPage
├── SetupSection                      [§ top — placeholders for now]
│   └── Tabs: iPhone | Android
│        └── (each) instructions-link slot + ShortcutTokenCard (token greyed + Copy + Regenerate, device label input)
├── RulesEditor
│   ├── GlobalGatesCard   (rating_floor Slider, require_verified Switch)
│   ├── ShareCard         (auto_reject Switch)
│   ├── TierCard "Standard" (floor Slider + AcceptLadderEditor rows)
│   └── TierCard "Premium"  (floor Slider + AcceptLadderEditor rows)
├── OffersTodaySection
│   ├── OfferStatsBar  (analyzed · analyzer-ACCEPT · YOU-accepted · realized $ — visibly distinct, fixes §0 bug)
│   └── OfferList → OfferRow
│        ├── analyzer decision badge + reason + per_mile/miles
│        ├── "I accepted this offer" Toggle  → driver_decision
│        └── EarningsForm (actual_pay / reimbursements / extras / other → total auto-sum, read-only) [shown when accepted]
└── OfferMap   (google-maps-loader; pins at driver_lat/lng colored by analyzer decision; overlay driver-actual outcome; H3 density optional)
```

---

## §7 · BUILD PHASES (each independently shippable; stop/review between)

| Phase | Deliverable | Acceptance |
|-------|-------------|------------|
| **1. Identity bridge** | `shortcut_token` on `driver_profiles`; token endpoints; resolve-on-ingest; populate `offer_intelligence.user_id` | A tokened request lands a row with correct `user_id`; un-tokened still works |
| **2. Rules engine refactor** | `rules-engine.js` (`DEFAULT_RULESET` + `buildPhase1Prompt` + `evaluateDeterministic`); endpoint uses it | **Golden test**: replayed offers decide identically to old code; "Verified"/rating drift resolved |
| **3. Rules storage + API + editor UI** | `offer_rulesets`; rules GET/PUT; RulesEditor section; per-offer `ruleset_hash` stamp | Edit a floor → next analysis uses it; reload persists; defaults seed on first visit |
| **4. Outcome capture** | `offer_outcomes`; offers GET + outcome POST; OffersTodaySection (toggle + earnings); **corrected stats** | Toggle + earnings persist; total auto-sums; stats separate analyzer vs driver |
| **5. Map** | OfferMap (decision-colored pins, outcome overlay) | Today's offers plotted; reflects rules/outcomes |
| **6. Setup cards content** | Real iPhone/Android Shortcut download + setup instructions | Placeholders replaced with working setup flow |

**Pre-PR gate each phase:** `npm run lint && npm run typecheck && npm run build` (CLAUDE.md §7).

---

## §8 · FORWARD-LOOKING / ML NOTES

- Store `ruleset_version`+`ruleset_hash` on every offer → answer "did tightening the
  floor improve realized $/hr?" without losing history.
- `offered price` (`offer_intelligence.price`) vs `realized total_earned`
  (`offer_outcomes`) = the prediction-error label.
- `analyzer decision` vs `driver_decision` disagreement + `driver_reasoning` =
  where the rules are wrong → candidate auto-tuning signal.
- `h3_index` + decision/outcome → "are my rules rejecting offers in areas that
  actually pay?" (the map makes this visceral).

---

## §9 · OPEN DECISIONS / RISKS

1. **Token mechanism** (§3) — system-assigned (recommended) vs user-chosen. *Needs final OK.*
2. **`offer_outcomes.user_id` on-delete** — cascade (mirrors Coach table) vs restrict (preserve ML data).
3. **Tier→product membership editability** — code-defined in Phase 2; editable UI is backlog.
4. **`offer_intelligence` truncate plan** (`migrations/20260505…:78`) — outcomes survive (FK set null), but confirm the truncate still happens post-launch.
5. **Rules-engine behavior parity** — mitigated by the Phase-2 golden test; this is the highest-risk refactor.

---

## §10 · NON-GOALS (this iteration)

- Changing the model roles (`OFFER_ANALYZER` / `OFFER_ANALYZER_DEEP` stay as-is).
- Editing tier→product mapping from the UI (backlog).
- Multi-device distinct tokens (one token/user for now).
- Replacing the public endpoint's device_id model (we *augment* with user_id, not replace).
