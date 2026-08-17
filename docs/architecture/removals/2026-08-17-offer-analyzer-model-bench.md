# Removed: OFFER_ANALYZER HIGH-era registry narration, gemini-pro-latest retry alias, adapter JSON-temperature override (2026-08-17)

**Context:** Melody (2026-08-17, verbatim): *"we need to fix model issues to get vision working.
It should be temp config to .1 if temp is allowed - please curl and analyze the fastest vision
model that can handle the end user rules and perform the analysis and get it back to the end
user in less than 3 seconds full trip."* Live benchmark + fixes shipped in this session; the
old text below is preserved per `app_rules: comment-hygiene`.

## 1. `server/lib/ai/model-registry.js` — OFFER_ANALYZER comment block replaced

Replaced by a compact block that records the 2026-08-17 live benchmark and the new default
(`gemini-3.5-flash-lite`). Removed text (verbatim; the HIGH/8192 narration was already
superseded by the 2026-08-14 step-down, and the "3.6 regresses object detection" caveat
measured a different task):

```js
  // ==========================
  // 9. SIRI HOOKS (offer_intelligence)
  // ==========================
  // 2026-02-15: Dedicated role for real-time ride offer analysis via Siri Shortcuts.
  // 2026-02-26: Reverted Pro → Flash. Pro with thinking timed out Siri Shortcuts (~30s limit).
  // Flash is purpose-built for fast vision extraction: <2s for screenshot → JSON decision.
  // No thinking needed — this is OCR + math + rule application, not reasoning.
  // 2026-05-29: Pinned to gemini-3.5-flash + HIGH thinking per Melody's request.
  // gemini-3.5-flash is the stable GA model (released 2026-05-19) that replaces the
  // gemini-3-flash-preview identifier. Verified live via ai.google.dev/gemini-api/docs:
  //   - multimodal (vision OK for offer screenshots)
  //   - thinkingLevel supports minimal/low/medium/high (default medium); HIGH is valid
  //   - JS field is thinkingConfig.thinkingLevel (lowercase value) — emitted by gemini-adapter.js
  // ⚠️ LATENCY TRADE-OFF: Phase 1 is the SYNCHRONOUS, Siri-bound path (<2s target,
  //    ~30s Shortcut hard timeout). HIGH thinking adds latency — the 2026-02-26 note below
  //    records that Pro+thinking previously timed out Shortcuts. Monitor response_time_ms;
  //    if Siri times out, step down to 'LOW'/'MINIMAL' or move deep reasoning to Phase 2
  //    (OFFER_ANALYZER_DEEP, which is async and not latency-sensitive).
  // ── HARDENED 2026-06-11 (determinism doctrine — do NOT regress) ──────────────
  //  ROLE: Phase 1 is the SINGLE fast analyzer for BOTH offer modalities —
  //    • VISUAL path: Siri Vision shortcut sends a screenshot (analyze-offer.js:275 → images[])
  //    • TEXT path:   Siri text shortcut → parseOfferText() regex pre-parse → same model
  //  MODEL gemini-3.5-flash — verified live (/v1beta/models) + web-benchmarked (I/O 2026):
  //    Flash 3.5 LEADS multimodal/vision (84.2% CharXiv) AND runs ~4× throughput / 2.6× faster
  //    than 3.1 Pro. It is simultaneously the most-accurate-vision and the fastest model — exactly
  //    what the eyes-on-road, Siri-bound decision needs. Do NOT "upgrade" Phase 1 to a Pro model:
  //    Pro is slower, weaker on multimodal, and would blow the ~30s Shortcut timeout.
  //  ⚠️ PINNED, NOT FLOATING: never gemini-flash-latest or any *-latest alias. Memory #342: a
  //    floating alias resolved server-side to an internal Google build and 404'd in production.
  //  2026-08-11: re-verified against gemini-3.6-flash (GA 2026-07-21) — do NOT move this
  //    role to 3.6: it regresses vision object detection (56.0% mAP@50, bottom half of
  //    Roboflow's Aug-2026 evals) while 3.5-flash stays the vision+speed leader.
  OFFER_ANALYZER: {
    envKey: 'OFFER_ANALYZER_MODEL',
    default: 'gemini-3.5-flash',
    purpose: 'Phase 1: Real-time fast analysis (visual screenshot OR parsed text) from Siri Shortcuts (ACCEPT/REJECT)',
    // 2026-08-14: HIGH → MINIMAL + 8192 → 1024, for Melody's <3s hard latency
    // target (todo #43). Live-benchmarked this day on gemini-3.5-flash, 3 runs
    // per config, real Phase-1 prompts (scratchpad bench, session 2026-08-14):
    //   text   HIGH/8192 avg 5249ms (matches prod p50 5.2s) → MINIMAL/1024 avg 3120ms
    //   vision HIGH/8192 avg 5496ms                          → MINIMAL/1024 avg 2512ms
    // Decision parity held at MINIMAL (same ACCEPT + identical terse reason as
    // HIGH; vision honestly answered "No ride offer visible" on a non-offer
    // screenshot). HIGH also parse-failed 1/3 vision runs — MINIMAL was cleaner.
    // maxTokens 1024 is deliberate WITH the step-down: the 2026-05-29 8192 bump
    // existed only because HIGH thinking consumed the output budget; at MINIMAL
    // the JSON decision is ~40-150 tokens, and the low cap also truncates
    // degenerate repetition tails (observed live at MINIMAL: a looping reason
    // string) in ~1s instead of letting them run for 8K tokens. A truncated
    // response parse-fails → the deterministic rules engine answers (the
    // always-answer contract in analyze-offer.js).
    // Deep reasoning lives in Phase 2 (OFFER_ANALYZER_DEEP, async) — exactly
    // the step-down path the latency trade-off note above prescribes.
    maxTokens: 1024,
    temperature: 0.1, // Near-deterministic for consistent decisions
    thinkingLevel: 'MINIMAL',
    features: ['vision'],
  },

```

**Reason:** the block narrated the HIGH-thinking era ("HIGH thinking adds latency", "step
down to LOW/MINIMAL") as if current, cited old line anchors (`analyze-offer.js:275`), and
its model claim (3.5-flash = fastest) is superseded by today's measurement (3.5-flash-lite
~700 ms vs 3.5-flash ~1.25 s, with 3.5-flash truncating JSON on 7/42 calls).

## 2. `server/lib/ai/adapters/index.js:214` — floating retry alias

Was: `const GEMINI_FALLBACK_MODEL = primaryConfig.model === 'gemini-3.5-flash' ? 'gemini-pro-latest' : 'gemini-3.5-flash';`
Now: `… ? 'gemini-3.1-pro-preview' : 'gemini-3.5-flash'` (pinned ids only). Also removed the
stale comment line `// 2026-05-08: Migrated to gemini-pro-latest alias (server-resolved by Google).`
**Reason:** `*-latest` aliases are forbidden for these roles (memory #342 prod 404); a Pro
retry auto-corrected MINIMAL thinking upward and could blow the Phase-1 20 s race.

## 3. `server/lib/ai/adapters/gemini-adapter.js:97-100` — JSON temperature override

Was: `const finalTemperature = expectsJson ? 0.2 : (temperature || 0.7);` (comment: "Use lower
temperature for JSON responses"). Now: `expectsJson ? Math.min(temperature ?? 0.2, 0.2) : (temperature ?? 0.7)`.
**Reason:** the registry's `temperature: 0.1` for OFFER_ANALYZER never reached Gemini —
every analyzer prompt says "JSON". Roles at/above 0.2 keep the previous behavior exactly.

## 4. `server/api/hooks/analyze-offer.js` — inline two-tier JSON ladder

The inline "Tier 1 direct parse / Tier 2 brace-slice" block (2026-03-02) moved to
`server/lib/offers/parse-model-json.js` (pure, tested) with a third tier that repairs a
missing closing brace — live-observed on gemini-3.5-flash 7/42 calls (finishReason STOP).
Phase 2 now uses the same parser (`{ unwrap: false }`).

## 5. Env examples / dev env

`OFFER_ANALYZER_MODEL=gemini-3.5-flash` → `gemini-3.5-flash-lite` in `.env.local`,
`.env.local.example`, `.env.example` (an env pin overrides the registry default; the prod
Replit Secret needs the same change or removal — Melody).

## 6. `client/src/components/offer-analyzer/RateTargetsCard.tsx` — accept-ladder rung editor removed (D4)

Melody (2026-08-17, verbatim): *"Can we remove the ladder input rungs I think leaving the
sliders… add the max min slider… I love the gates locations everything else."* Removed:
`describeRung`, `NumberField`, the "Accept ladder / Add rung / Rung N" block (Min $/mi,
Min $/min, Min/Max total minutes inputs, per-rung delete). Replaced by four sliders per
tier + a "$/hr in results" switch; the ladder is derived (`withDerivedLadder`) as one rung.
**Reason:** typed numeric inputs invited bad data and multiplied the variables sent to the
vision model; sliders with preset ranges keep values valid by construction. Engine gained
`tiers.*.max_total_miles` (REJECT `too_far`) and the vision path an arbitration step so the
engine, not the model, decides the numeric rules on extracted numbers.


## 7. Comment-hygiene sweep (todo #47, auto-mode)

| File | Was | Now / reason |
|---|---|---|
| `server/lib/ai/adapters/gemini-adapter.js:1` | `// server/lib/adapters/gemini-adapter.js` | correct path `server/lib/ai/adapters/…` |
| `gemini-adapter.js:71` | thinkingLevel doc `"low", "medium" (Flash only), "high"` | adds `minimal` (3.5 Flash) and points at `validateThinkingLevel()` |
| `server/lib/ai/adapters/index.js:7` | `// Last updated: 2026-02-10 (Hedged Router Integration)` | removed — a "last updated" that stopped being updated is a lie; git holds history |
| `server/lib/ai/model-registry.js` | two sections numbered `9.` | `10. INTERNAL AGENTS` |
| `model-registry.js:711,745` | "Enforced by gemini-adapter.js validateThinkingLevel()" for MODEL_QUIRKS | marked documentary — the validator uses its own flash/pro checks and never reads MODEL_QUIRKS |
| `model-registry.js getRolesByTable()` | no `AI`/`OFFER` groups (roles silently dropped) | groups added |
| `tests/offers/rules-engine-parity.test.js:7,144` | cites `analyze-offer.js:367-414` / `:99-139` (pre-extraction anchors) | describes them as the pre-2026-06-20 legacy ladder/prompts, now only in the test |
| `migrations/20260505_coach_offer_decisions.sql:12` | "See claudeMd Rule 8" (no such rule since the boot-sequence rewrite) | names the actual owner (Coach action tags) |
| `shared/schema.js:1748,1751` | decision comment omitted legacy `UNKNOWN`; ai_model example `"gemini-3-flash"` | decision = spoken verdict, legacy UNKNOWN noted; ai_model = model that actually answered |
