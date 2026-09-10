# PLAN — Intake 2026-08-26: Melody's handoff pack → verified bugs, root-cause fixes, enhancements

> **Provenance:** Claude-authored (repo session, Claude Fable 5, 2026-08-26), working
> autonomously on Melody's instruction ("you don't need me mode… consolidate them into
> verification of bugs, root cause fixes and enhancements… test with your agents until no
> more bugs exist… only rules: 6 decimal, fallback hard, waterfalls have pipelines we have
> spent a year building and this will not be one shot"). Intent holder: Melody.
> Every handoff below is **another session's output** (Cowork Claude, 2026-08-17 → 08-24):
> research input per `AI_PARTNERSHIP_AGREEMENT.md` §19.1, verified here against the real
> code/DB before anything was changed. ⚖️ = a default I chose that Melody may overrule.
>
> **Status legend:** ✅ verified true · ❌ verified false/stale · ⚠️ partially true ·
> 🔒 blocked on Melody · 🛠 fixed in this session · 📋 logged as todo

---

## 0 · Ground truth at intake (repo `main` @ `982745c7`, dev DB via `DATABASE_URL`)

- Both Cowork commits (`cbcb9fb`, `1f6b262`) are ancestors of HEAD; **ten "Published your
  App" commits followed (2026-08-20 → 08-26)** → the raw image-body mode and the spoken-ARP
  fix are live on prod. The "one republish needed" item in handoff #1 is **stale** ❌.
- Offer test baseline before any change: `npx jest tests/offers` → **9 suites / 114 tests
  pass** (`OFFER_ANALYZER.md` §18 still says 5/66 — doc drift, fixed below).
- A new remote branch appeared on `git fetch`: `origin/claude/upfront-fare-tips-validation-ranzcf`
  (another Claude session). Not merged, not read — research input only. 📋
- No dev server was running at intake; unit tests + direct module calls used for
  verification, then a disposable local boot for the endpoint smoke (§6).

---

## 1 · Handoff #1 — Android Offer Analyzer: Cowork session handoff (2026-08-17/18)

| # | Claim / item | Status | Evidence / decision |
|---|---|---|---|
| 1.1 | `android_text` lane live and fast on Melody's Samsung; G3 effectively passed for text | ✅ (field-verified by Melody; not re-verifiable here) | Accepted as Melody's ground truth. Remaining G3 formality (response_time_ms vs felt-time over a shift) stays with Melody. |
| 1.2 | Server raw image body mode on main (`middleware.js:239`, `analyze-offer.js:248-256`) | ✅ | Read both. `express.raw({type:['image/*','application/octet-stream'], limit:'5mb'})`; route sniffs PNG/JPEG/WebP/GIF magic bytes; fields ride query params. |
| 1.3 | "Two commits landed after the last publish — one republish needed" | ❌ stale | See §0 — published since 2026-08-20. |
| 1.4 | "OCR array renders as `[0]: …` lines; server regexes parse natively — no join step" | ✅ verified by execution | `parseOfferText` gives byte-identical `full`-confidence output for plain, `[n]:`-indexed and comma-joined renderings of the same card. The Android guide's Part 4 step 3 ("JavaScript join") is unnecessary → guide rewritten 🛠. |
| 1.5 | Driver kit (`Vecto_Offer_Analyzer.macro`, `DRIVER_SETUP_ANDROID.md`) built, "not yet in repo" | 🔒 | Neither file exists in the repo (`find` = 0 hits) **nor in the Drive folder Melody shared** (listed both pages + the "Computer Vision" subfolder). They live in the Cowork chat. **Melody: drop both files into the Drive folder or `docs/architecture/` and I will review + host them.** Until then the SetupCard cannot link a `.macro`. |
| 1.6 | Decision: no "Uber" anywhere in marketing AND driver docs; generic term "the third-party app" | ✅ Melody decision of record | Driver docs swept 🛠: `ANDROID_SHORTCUT_ANALYZE.md` (1 mention), `SIRI_SHORTCUT_ANALYZE.md` (2 mentions — the open question "sweep SIRI too?" resolved **yes** ⚖️: it is a driver doc and the rule as stated covers driver docs). Product/tier *names* in UI (`RateTargetsCard` "Standard (UberX, Lyft)") are **not** touched — that is the pending 2026-08-18 UX restructure decision (memory #378), not this rule. |
| 1.7 | MacroDroid bugs → rules (Set Variable order, dictionary magic text, Standard vs JSON picker, entire-screen consent, dontkillmyapp, Take Screenshot action) | ✅ phone-side facts (Melody-verified) | These are **build-guide content, not `lessons_learned` rows** (that table is for this repo's production mistakes). Folded into the rewritten Part 4 + troubleshooting table 🛠. |
| 1.8 | Live `vp_` token appeared in the Cowork chat and in macro exports | 🔒 Melody action | **Regenerate the token on the Offer Analyzer page once testing settles** (SetupCard → Regenerate). Never distribute a personal export. Logged as todo 📋. |
| 1.9 | Completion list: build `android_vision` macro; certify distributable; trim text macro; gather 📸 slots | 🔒 Melody/phone-side | Cannot be done from the repo. Logged 📋 with the server-side facts they need (query-param contract, 413 shape, `source=android_vision`). |
| 1.10 | SetupCard refresh: host token + `.macro` + guide on the page | ⚠️ partially blocked | Token is already on the page. `.macro` hosting blocked on 1.5; iCloud links blocked on todo #45. Not changed this session (blocked inputs). |
| 1.11 | Repo write-backs: rewrite Android Part 4 from the field-verified build; `OFFER_ANALYZER.md` §4.1 add raw-body content types; flip roadmap raw-body item to done; start use-case corpus folder | ⚠️ | §4.1 **already** lists raw `image/*` / octet-stream (v3.3 entry) ✅; roadmap G3 **already** says "raw image/* body mode — DONE 2026-08-17" ✅ → both stale asks. Part 4 rewritten 🛠. Corpus folder: created as `tests/offers/fixtures/README.md` + the three real cards from handoff #2 🛠. |
| 1.12 | Incident: a Cowork stop-hook instructed rewriting five `main` commits to Claude authorship + force-push; refused | ✅ verified history untouched | Recent authors are Melody / Replit Agent; no force-push evidence. Repo `.claude/settings*.json` contain **no hooks** (checked). Correct refusal (provenance falsification + hard-limit destructive op). |
| 1.13 | Helper app (todo #37) ADR offered | 📋 | Not requested; not drafted. |

## 2 · Handoff #2 — DELIVERY_LANE_BRIEF (2026-08-24): live wrong verdict + delivery lane

### 2.1 The incident — **reproduced locally, root cause confirmed** ✅

Verbatim live payload (MacroDroid System Log, `source: android_text`) through the real
`parseOfferText` → `classifyTier` → `evaluateDeterministic` with `DEFAULT_RULESET`:

```
LIVE $750   parse: price 750 · pair 19min/4.6mi (single, treated as ride) · per_mile 163.04 · per_min 39.47 · product null · confidence partial
            tier standard → ACCEPT / accept        ← the live wrong verdict, exactly
clean $7.50 parse: price 7.5 · per_mile 1.63 · per_min 0.39 → ACCEPT (standard defaults)
Comfort     parse: price 13.25 (the "$33.13/active hr" correctly excluded) · 23 min · 9.3 mi · per_mile 1.42 → premium ACCEPT
```

Anchors from the brief, each read (not grepped):

| Anchor | Status |
|---|---|
| `extractPrice()` candidates regex `\$\s?(\d+(?:\.\d{1,2})?)` accepts `$750`; 2-decimal preference cannot help (no 2-decimal candidate) | ✅ `parse-offer-text.js:28-41` |
| `extractProductType()` knows ride brands only → delivery = `null` → standard tier | ✅ `:95-131` |
| Single time-distance pair → treated as ride; pickup-vs-trip logic blind | ✅ `:272-287` |
| `evaluateDeterministic()` rejects *low* $/mi only; nothing rejects implausibly *high* | ✅ `rules-engine.js:310-430` |
| `$/hr` readout computed from the same poisoned price | ✅ `analyze-offer.js:673-682` |
| `formatPerMileForVoice` renders ≥$100 as "163 dollars four" | ✅ `numberToWords` returns `String(n)` for n>99 |
| Engine-ACCEPT-beats-model-REJECT arbitration (vision) would override a deep-model dissent | ✅ `analyze-offer.js:618-622` — **but note:** the $750 case was the **text** lane, where the model's answer is used directly (no arbitration). The text lane went: `partial` parse → not fast-lane → model saw `PRE-PARSED: $750 … $163.04/mi` and echoed ACCEPT. So a tripwire **only** inside `evaluateDeterministic` would NOT have caught the live case — the gate has to sit in the request path too (design below). |

Root cause (one sentence): **no money field had a plausibility bound anywhere between the
OCR and the spoken verdict, and the text lane trusts the model's echo of the pre-parse.**

### 2.2 Fix A — implausible-parse tripwire (design as built) 🛠

- `DEFAULT_RULESET.sanity = { max_price: 500, max_per_mile: 30, max_per_hour: 300, min_price: 1 }`
  ⚖️ **Melody: bless or change.** Why these and not the brief's 300/20/150/2: a decimal drop
  is always a **×100** error, so any real card lands thousands of $/hr — every ceiling
  catches it — while the brief's `$150/hr` / `$20/mi` would false-trip legitimate short
  surge hops ($20 for a 7-minute hop = $171/hr; a $30 1.2-mile surge = $25/mi) into
  "decide manually". `min_price 1` (not 2): real delivery offers exist at $2.50. All four
  are per-driver editable (DB) but deliberately **not** in the editor yet (⚖️ advanced knob,
  see §2.5).
- A price **with no cents and ≥ $100** is itself implausible (platform prices are always
  cents-precise) → `parse-offer-text.js` now reports `price_format: 'cents' | 'integer'`
  and the gate trips on `integer && ≥ 100` even when the derived rates are in band.
- `checkSanity(raw, ruleset)` (rules-engine.js, exported) is applied at **three** points:
  1. inside `evaluateDeterministic` after the share short-circuit (share is an identity
     reject — correct regardless of numbers) and before every other gate;
  2. **text lane, before the model call** — a tripped pre-parse answers `NO DATA`
     immediately (authoritative, cached for replay; no model spend on garbage);
  3. **final gate after vision arbitration**, on the numbers the notification would use —
     so an engine `implausible_parse` can never be overridden into ACCEPT by anyone.
- Output keeps the banner-strip contract: notification `NO DATA: $163.04/mi implausible —
  decide manually`, voice `No data. Numbers look wrong. Decide manually.`, `reason_kind:
  'implausible_parse'` stored in `parsed_data_json`.
- **Storage decision** ⚖️: plain `NO DATA` still skips Phase 2 (Melody 2026-08-17). An
  `implausible_parse` is different — it is a **real offer we failed on** — so it **does**
  run Phase 2 and store a row (the deep model's extraction is kept as data, the spoken
  `NO DATA` stays the record) and shows amber on the Offers card. Forensics for the next
  $750 are then one click away instead of a phone-log dig.
- `formatPerMileForVoice` hardened for ≥ $100 (unreachable once the gate lands, trivial).
- Decimal-repair (750 → 7.50) **not** built (brief: opt-in, jointly decide). ⚖️

### 2.3 Fix B — delivery lane 🛠

- **Parse:** `offer_kind: 'ride' | 'delivery'`, `tip_included`, `product_type` `Delivery` /
  `Delivery Exclusive` (canonical casing; tolerant of leading OCR glyph junk — the live
  card read "YP Delivery Exclusive"). Detection: `\bDelivery\b` chip (primary), "Includes
  expected tip" (sets `tip_included`), single pair suffixed `total` (`19 min (4.6 mi) total`).
  For delivery the single pair is the **total** (restaurant leg + drop leg): `total_*`
  set, `pickup_*`/`ride_*` null, no pickup-vs-trip logic.
- **Rules:** new top-level block (not inside `tiers` — those carry the ladder shape that
  `cloneTier`/renderers iterate):
  `delivery: { enabled: true, min_per_mile: 1.50, min_per_hour: 25, max_total_miles: 12 }`
  ⚖️ **placeholder defaults from the brief — Melody to set.** Evaluation: `$/mi = price /
  total_miles`, `$/hr = price / total_minutes × 60`; REJECT `delivery_low_mi` /
  `delivery_low_hr` / `delivery_too_far`, else ACCEPT. Delivery skips ride-only rules
  (rating, Verified, pickup, share, ladders). `enabled: false` → `NO DATA` with reason
  `delivery_off` ("Delivery offers are off in your rules").
- **Lanes (Melody 2026-08-24: delivery is VISION-lane):** the vision prompt gains a
  `DELIVERY` section (product `"Delivery"` → delivery rules), the deep prompt gains
  `offer_kind`/`tip_included` extraction + the delivery block, and vision arbitration
  re-runs the engine with tier `delivery` on the model's extracted numbers — through the
  **same** sanity gate (lane-agnostic). Text-lane delivery (older client): detection +
  tripwire + deterministic delivery rules, **no model call** (no judgment rule applies to
  delivery; avoid-zone geometry is still audited in Phase 2 as data). ⚖️
- **Tip honesty call-out:** notification always carries `| tip incl.` when
  `tip_included`; the spoken line adds "expected tip included" only when the offer clears a
  floor by < 15 % (brief's rule) — never silently discounts the fare.
- **Client signature (Melody 2026-08-24):** optional `shortcut_system` field (aliases
  `client`, `shortcutsystem`, `automation`), normalized on ingest (lowercase, `[a-z0-9._/ -]`,
  ≤ 40 chars), logged on every `[HOOKS]` incoming line, stored in
  `parsed_data_json.shortcut_system` and shown as a small tag on Offers rows. **Not** a
  column ⚖️: an `ALTER TABLE` is a schema change I will not make unattended (CLAUDE.md §5);
  the jsonb path is additive, reversible and queryable (`parsed_data_json->>'shortcut_system'`).
  Promote to a column in a Melody-approved migration if analytics want it indexed.
- **UI (Melody: "also show in UI"):** Offers rows — `Delivery` chip (+ Exclusive), `x mi
  total`, `tip incl.` tag, amber **PARSE ERROR — decide manually** badge for
  `implausible_parse` (never green), client tag; deep-model dissent line unchanged. Rules
  editor — new **Delivery** card (enable switch, min $/mi, min $/hr, max total miles) on
  the same PUT/409 flow; `sanity` round-trips untouched (no editor yet ⚖️).
- **Schema:** `ruleset-schema.js` + client zod accept `delivery` + `sanity`; `migrateRuleset`
  injects defaults (idempotent; schema_version literal stays 3 — additive keys, so stale
  clients keep working). No `offer_intelligence` column added (see signature note).

### 2.4 Fixtures 🛠
1. Delivery clean OCR (`$7.50`, 19 min, 4.6 mi) → `$1.63/mi`, `$23.68/hr` → with defaults
   **REJECT delivery_low_hr** (1.63 ≥ 1.50 passes; 23.68 < 25 fails).
2. **Verbatim live `$750` payload** → `NO DATA implausible_parse` — must NEVER be ACCEPT;
   `Delivery Exclusive` detected through the `YP` glyph junk; lines `[0]`/`[5]` contribute
   no price candidate.
3. Comfort ride regression (`$13.25`, `$33.13/active hr`, 5.00★ Verified, 13 min/5.5 mi +
   10 min/3.8 mi) → unchanged: `$1.42/mi`, 9.3 mi, premium ACCEPT.
Plus the same three cards in `scripts/offer-analyzer-smoke.mjs`.

### 2.5 Explicit non-decisions left for Melody ⚖️
Sanity ceilings; delivery floors; sanity knobs in the editor; decimal-repair opt-in;
`shortcut_system` as a real column; multi-platform delivery brands beyond the generic chip.

## 3 · Handoffs #3/#4 — Ride Type & Vehicle Eligibility Taxonomy (2026-08-24)

- **Update (Melody's Drive folder, shared mid-session):** `RIDE_TYPE_TAXONOMY.pdf` (v1.0,
  2026-08-18, US scope) and the Google Doc *Copy of Verify DFW Rideshare Taxonomy* — which is
  actually **v2.0 (2026-08-19, scope Global)**, the successor the session report never
  mentioned — were both read in full. **v2.0 landed as
  `docs/research/RIDE_TYPE_TAXONOMY.md`** 🛠 (content verbatim; markdown normalized from
  the Doc export; provenance + "internal asset, never driver-facing" banner added). v1→v2
  deltas: five global platforms added to the registry (Bolt, DiDi, Grab, FreeNow, Ola),
  DoorDash Dasher-Rewards thresholds replaced by the cited 0–100 points model, Lyft-Texas
  facts footnoted to primary sources. `RIDE_TYPE_CATALOG.v1.json` was **not** in the folder
  — still outstanding 🔒. The "Computer Vision" subfolder is empty.
- Also in the folder, not project-relevant today: `DE-UBER.md` (a 2025-09 codemod note that
  renamed `uber-api` → `ridehail-ai` and "Standard/XL/Black/Eats" → "Standard/XL/Premium/
  Delivery" — an older cousin of the current naming rule), `business-strategy-v1.md`
  (2025-08 positioning), `androidclientbuild.pdf` (the Cowork's superseded Android working
  sheet; its two "absorb back" asks — the dev/prod token gotcha and the `response_time_ms`
  protocol — are **already** in `ANDROID_SHORTCUT_ANALYZE.md` ✅; its "run the OCR action
  over the live app to test FLAG_SECURE" pre-check became a field-verified note in Part 4
  🛠), plus 2025-era pasted logs/zips/images (session-vault history).
- Analyzer-relevant findings recorded for when the files arrive (📋 todo rows T1–T11 as
  one umbrella + the two that touch the parser):
  - Uber composes cards as `{tier} • {modifier}` — `extractProductType` should split on
    the bullet (not done now: no ground-truth card strings in hand; the brief's own T5/T6
    say the badge strings are still unconfirmed).
  - Uber Green → Uber Electric (2025-10-22); Lux retired; Premier ↔ Black mutually
    exclusive per city (Premier on a DFW screen = read error) — alias-map inputs.
  - Trip Radar guard: Match never touches acceptance rate; cancelling **after** matching
    hits cancellation rate — a Coach/rules doctrine item, not analyzer code.
  - The live `getEligibleVehiclesForCity` feed is a reference-table source
    (`vehicle_makes_cache` / `vehicle_models_cache` already exist in the DB) — T1/T8.

## 4 · Work done this session (files)

See the closing summary in `claude_memory` (session row) and the file list in §7 of this
document, kept current as work lands.

## 5 · Verification protocol

1. `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/offers` — all suites, incl. the
   new fixtures; parity pins untouched.
2. `npm run lint` and `npm run typecheck` (server JS + client TS).
3. Disposable local boot → `scripts/offer-analyzer-smoke.mjs` text cards (deterministic
   lanes do not need a model key) + a raw-body POST; read the `[HOOKS]` log lines.
4. Adversarial review workflow: independent readers try to refute (a) that the `$750`
   class is closed on **every** lane, (b) that ride decisions at defaults are unchanged,
   (c) that the delivery rules can't be reached by a ride card, (d) that the editor
   round-trips a pre-existing v3 config without stripping/altering it.

## 6 · Smoke results (disposable local boot, port 5055, `.env.local`, 2026-08-26)

`BASE=http://127.0.0.1:5055 node scripts/offer-analyzer-smoke.mjs` (untokened → default rules):

| Card | Decision | Voice | Notification | Server ms |
|---|---|---|---|---|
| A UberX Priority $1.40/mi | ACCEPT (model lane) | Accept. dollar forty per mile, 6 miles. | `ACCEPT: $1.40/mi 6.1mi 14min` | 869 |
| B fast REJECT | REJECT (fast lane) | Reject. seventy-three cents per mile, 9 miles, below floor. | `REJECT: $0.73 8.5mi floor` | 3 |
| C share | REJECT | Reject. Share tier. | `REJECT: share` | 1 |
| **D delivery, clean** | **REJECT (delivery lane, no model)** | Reject. dollar sixty-three per mile, 4.6 miles total, delivery, below your hourly floor, about 24 dollars an hour. | `REJECT: $1.63 4.6mi delivery low hourly \| $24/hr \| tip incl.` | 3 |
| **E delivery, live `$750`** | **NO DATA (tripwire, model skipped)** | No data. Numbers look wrong. Decide manually. | `NO DATA: $163.04/mi implausible — decide manually` | 3 |
| F Comfort regression | ACCEPT (model lane, premium) | Accept. dollar forty-two per mile, 9 miles. | `ACCEPT: $1.42 23min` | 505 |
| A re-sent | ACCEPT — `duplicate:true`, Phase 1/2 skipped | | | 0 |

Log line for E: `[HOOKS] 🚧 Implausible parse (text lane, model skipped): price $750 above $500;
price $750 has no cents; $163.04/mi above $30/mi; $2368/hr above $300/hr — NO DATA`.

Raw-body path: tiny PNG with `?source=android_vision&shortcut_system=MacroDroid/5.65` →
`[HOOKS] 📱 Incoming from smoke_raw (android_vision via macrodroid/5.65)`, Phase 1 model
rejected the garbage bytes → deterministic NO DATA (always-answer contract held). 6 MB raw
body → **413** with the spoken shape. JSON body with the `client` alias → `Field aliases
accepted: client→shortcut_system` warn + `via macrodroid/5.65` on the incoming line.

Model lanes are **live** (Phase 1 869/505 ms; Phase 2 `gemini-3.1-pro-preview` 5.7–7.2 s
DONE) — the Gemini billing depletion recorded 2026-08-19 (memory #379) has cleared. Rows for
A and B were stored with `tz America/Chicago via pickup_address` (untokened smoke device;
dev DB).

Gates: `npx jest tests/offers` **10 suites / 136 tests**; full `tests/` **792 pass, the same 7
pre-existing failing suites** as the todo #19 baseline (no new failures); `npm run lint`
clean; `npm run typecheck` (`tsc -b`) clean; `npm run build` (client) clean.

## 7 · Adversarial review (workflow `wf_93c913c5-0ae`, 6 lenses / 29 agents, 0 errors)

Six independent lenses tried to **refute** the closure claims (tripwire coverage, ride
parity, delivery lane, storage/Phase-2, schema round-trip, ingest surface); every finding
was then re-verified by an independent agent instructed to default to *not confirmed*.
**17 confirmed, 6 refuted.** (Four of the six "refuted" verdicts were verifiers racing my
in-flight fixes — they checked code I had already corrected.) All 17 are addressed:

| # | Confirmed finding | Resolution |
|---|---|---|
| 1 | **HIGH ×4 lenses** — a real ride card containing the word "Delivery" (address, restaurant, chrome) was routed down the delivery lane: rating / Verified / pickup / ladder gates skipped, verdict could flip to ACCEPT | 🛠 The **shape** decides. `deliveryProduct()` only becomes `product_type` when `isDeliveryCard()` agrees, and **two time-distance pairs is always a ride**; `analyze-offer.js` routes on `preParsed.offer_kind`, not the product string. Regression tests: UberX + "1200 Delivery Dr", brandless card, Comfort + "Delivery Station 4" |
| 2 | **HIGH** — integer price **under** $100 bypassed the tripwire: `$750`→`$75O`, or `$7.50`→`$75`, spoke ACCEPT at $16.30/mi | 🛠 The decimal-drop rule is now rate-based too: `max_per_mile_no_cents` 10 / `max_per_hour_no_cents` 200 ⚖️ |
| 3 | **HIGH** — implausible rows stored the poisoned `price`/`per_mile`, and two `avg_per_mile` aggregations (hooks stats + Coach DAL) averaged them in | 🛠 Implausible rows store **NULL money columns** (forensics live in `parsed_data_json` + `raw_text`); `avg_per_mile` averages only rows that have a rate |
| 4 | **MEDIUM** — the tripwire flipped **real** ride verdicts at defaults ($35 / 1 mi / 5 min surge → "No data") | 🛠 Rate ceilings need a meaningful denominator (≥ 1 mi, ≥ 5 min); `max_per_mile` 30→40, `max_per_hour` 300→500. The residual change is intended and now documented as such (my "ride decisions unchanged" claim in §2.2 was too strong) |
| 5 | **MEDIUM** — a model reply with `"$750"` coerced to `null`; a null money field is invisible to every gate, so its ACCEPT stood on unchecked numbers | 🛠 `toNum` strips currency dressing (`$`, commas, spaces); the vision path uses the same coercion |
| 6 | **MEDIUM** — vision delivery with unreadable minutes: engine NO DATA was discarded and the model's verdict spoken | 🛠 The engine owns delivery **including its NO DATA** |
| 7 | **MEDIUM** — `delivery.enabled:false` removed delivery from the prompt entirely, so the model silently judged delivery cards by ride rules | 🛠 Disabled still teaches the model to **label** the card, then refuse it; `classifyTier` matches the model's free-text product case-insensitively |
| 8 | **MEDIUM** — vision/Phase-2 prompts grew (DELIVERY section + `tip_included`) for every ride screenshot | ✅ Intended and documented; the byte-pinned prompts (`buildPhase1Prompt` standard/premium/share) are untouched and still pinned by the parity suite |
| 9 | **LOW** — all four sanity ceilings could be nulled through the ordinary PUT | 🛠 `migrateRuleset` re-fills a null ceiling with the default — a safety floor, not a taste knob |
| 10 | **LOW** — the model could smuggle `implausible: true` in its reply and skip our own final gate | 🛠 `SERVER_OWNED_KEYS` stripped from every model reply |
| 11 | **LOW** — negative money passed as "not read" | 🛠 Negative price/miles/minutes is a breach |
| 12 | **LOW** — untokened implausible requests still spent the deep model + Google calls | 🛠 Implausible rows are stored (and Phase 2 run) only for a **tokened** driver |
| 13 | **LOW** — `(…->>'tip_included')::boolean` would 500 the endpoint on a non-boolean legacy value | 🛠 Tolerant `IN ('true','t','1')` read |
| 14 | **LOW ×2** — DeliveryCard rendered seed values for schema-legal **null** floors, misrepresenting the active rules | 🛠 A null floor renders as **off** (switch + slider), and can be set back to off |
| 15 | **LOW** — client zod hard-required `delivery`/`sanity`; a deploy-skewed server response would fail the whole editor | 🛠 Both carry `.default(…)` |
| 16 | **LOW** — deterministic reason text now uses the engine's effective `$/mi` (differs for `basis:'active_time'` drivers) | ✅ Intended (the number shown is the number that decided); documented |
| 17 | **LOW** — stored `config_hash` goes stale vs the migrated config until the driver's next Save | ✅ Verified harmless (nothing compares it); documented |

**Accepted limit, not fixed (⚖️ Melody):** a ×10 **miles** misread (`4.6 mi` → `46 mi`)
yields `$0.16/mi` and a spoken REJECT on wrong numbers. Any lower bound that caught it would
also refuse genuinely bad long offers, and the direction is safe (REJECT, never a wrong
ACCEPT). Documented in `OFFER_ANALYZER.md` §6.3.

### Post-fix verification (fixed code, disposable boot on :5055)

| Probe | Result |
|---|---|
| RIDE card with "1200 Delivery Dr" | **ACCEPT $2.33 6.1mi** — ride ladder, no delivery tags ✅ |
| One-glyph decimal drop `$75` for $7.50 | **NO DATA** `$16.30/mi implausible` (was ACCEPT) ✅ |
| Legit surge $35 / 1.0 mi / 5 min | **ACCEPT $35.00 1.0mi** (was a false NO DATA) ✅ |
| Live `$750` payload | **NO DATA** `$163.04/mi implausible` ✅ |
| Clean delivery $7.50 | **REJECT $1.63 4.6mi delivery low hourly \| $24/hr \| tip incl.** ✅ |

Gates after the fixes: `jest tests/offers` **10 suites / 142 tests**; `npm run lint` clean;
`npm run typecheck` clean; full `tests/` unchanged from the 7-suite baseline.

## 8 · File inventory (this session)

**Server** — `server/lib/offers/parse-offer-text.js` (price format, delivery shape,
`deliveryProduct`/`extractTotalPair`/`isDeliveryCard`, voice ≥ $100), `…/rules-engine.js`
(`sanity` + `delivery` blocks, `checkSanity`, `evaluateDelivery`, gate order, delivery
prompt renderer, migration), `…/ruleset-schema.js`, `…/normalize-offer-body.js`
(`shortcut_system` + normalizer), `server/api/hooks/analyze-offer.js` (three tripwire seats,
delivery lane, arbitration, currency coercion, server-owned keys, storage, stats),
`server/api/offer-analyzer/index.js` (lane/provenance columns in `GET /offers`).
**Client** — `client/src/lib/offer-ruleset-schema.ts`, `…/components/offer-analyzer/DeliveryCard.tsx`
(new), `…/OffersCard.tsx`, `…/pages/co-pilot/OfferAnalyzerPage.tsx`.
**Tests** — `tests/offers/delivery-and-sanity.test.js` (new, 28 tests),
`tests/offers/fixtures/README.md` (new — the real-card corpus), `scripts/offer-analyzer-smoke.mjs`.
**Docs** — `docs/architecture/OFFER_ANALYZER.md` (v3.9), `…/OFFER_ANALYZER_ROADMAP.md`,
`…/ANDROID_SHORTCUT_ANALYZE.md` (Part 4 rewritten from the field-verified build),
`…/SIRI_SHORTCUT_ANALYZE.md` (platform-name sweep), `…/removals/2026-08-26-offer-analyzer-v3.2.md`
(new), `docs/research/RIDE_TYPE_TAXONOMY.md` (new — v2.0 from Drive), this plan.
**DB** — `lessons_learned` #33; `todo` #67–#72; `todo` #57 amended.
**Not committed, not published** — Melody's word (todo #69).

## 9 · What is left for Melody

1. ⚖️ The defaults in §2.5 + the new `*_no_cents` ceilings (todo #69).
2. Commit + republish — the client bundle changed (todo #69).
3. Regenerate the leaked `vp_` token (todo #67).
4. Drop the driver kit + `RIDE_TYPE_CATALOG.v1.json` where I can reach them (todo #68, #71).
5. Phone-side: the Android vision macro + distributable certification (todo #70).
6. Say what `origin/claude/upfront-fare-tips-validation-ranzcf` is (todo #72).
