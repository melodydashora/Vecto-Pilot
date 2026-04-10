# AI_MODEL_UPDATE_STRATEGY.md — Strategy for Updating AI Models

> **Canonical reference** for model versions, selection rationale, swap patterns, and deprecation migration.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Current Model Versions](#1-current-model-versions)
2. [Model Selection Rationale](#2-model-selection-rationale)
3. [How to Swap Models](#3-how-to-swap-models)
4. [Version Pinning](#4-version-pinning)
5. [Cost Comparison](#5-cost-comparison)
6. [Migration Path When Models Deprecate](#6-migration-path-when-models-deprecate)
7. [Current State](#7-current-state)
8. [Known Gaps](#8-known-gaps)
9. [TODO — Hardening Work](#9-todo--hardening-work)

---

## 1. Current Model Versions

| Provider | Model | Roles Using It |
|----------|-------|---------------|
| **Google** | `gemini-3.1-pro-preview` | All BRIEFING_*, AI_COACH, CONCIERGE_*, STRATEGY_CONTEXT, VENUE_TRAFFIC, VENUE_EVENT_VERIFIER, UTIL_RESEARCH, OFFER_ANALYZER_DEEP |
| **Google** | `gemini-3-flash-preview` | OFFER_ANALYZER (Phase 1, vision) |
| **Google** | `gemini-3.1-flash-lite-preview` | UTIL_TRANSLATION |
| **Anthropic** | `claude-opus-4-6` | STRATEGY_CORE, STRATEGY_TACTICAL, STRATEGY_DAILY |
| **Anthropic** | `claude-haiku-4-5-20251001` | VENUE_FILTER |
| **OpenAI** | `gpt-5.4` | VENUE_SCORER, UTIL_MARKET_PARSER |

---

## 2. Model Selection Rationale

### Why Gemini for Briefing?

- **Google Search grounding** — Briefing needs live web data (events, news, airport conditions). Gemini natively integrates Google Search as a tool.
- **thinkingLevel support** — HIGH thinking for complex reasoning (traffic analysis, event discovery).
- **Cost** — Gemini is more cost-effective than Claude for high-volume search tasks.

### Why Claude for Strategy?

- **Deep reasoning** — Strategy requires synthesizing multiple data sources into coherent tactical advice.
- **Instruction following** — Claude produces consistently structured output (GO/AVOID/WHEN/WHY format).
- **Reliability** — Claude Opus is the most reliable for long-form generation.

### Why GPT-5.4 for Venue Scoring?

- **Structured JSON output** — GPT-5.4 with `reasoningEffort: medium` produces well-formed venue recommendation JSON.
- **Reasoning capability** — Venue scoring requires spatial reasoning and multi-factor analysis.

### Why Haiku for Venue Filtering?

- **Speed and cost** — Classification (P/S/X) is simple; Haiku is fast and cheap.
- **Low stakes** — Misclassification is cosmetic (wrong tier), not safety-critical.

### Why Flash Lite for Translation?

- **Real-time requirement** — Translation must be <500ms for conversational pace.
- **Simple task** — Text-to-text translation doesn't need deep reasoning.
- **Cost** — Cheapest model available; translation is high-volume during FIFA World Cup.

---

## 3. How to Swap Models

### Via Model Registry

**File:** `server/lib/ai/model-registry.js`

To change a role's model:
```javascript
// In MODEL_ROLES:
STRATEGY_TACTICAL: {
  default: 'claude-opus-4-6',  // ← Change this
  purpose: '1-hour tactical',
  maxTokens: 16000,
  temperature: 0.5
}
```

### Via Environment Override

Two env vars allow runtime override without code changes:
- `AGENT_OVERRIDE_MODEL` — Override for agent roles
- `AI_COACH_OVERRIDE_MODEL` — Override for AI Coach (must support streaming)

### Via Adapter Pattern

The adapter layer (`server/lib/ai/adapters/index.js`) routes models to providers by name prefix:
- `claude-*` → Anthropic adapter
- `gemini-*` → Gemini adapter
- `gpt-*` or `o1-*` or `o3-*` → OpenAI adapter

Changing a model name automatically routes to the correct adapter.

### Provider-Specific Quirks to Watch

| Provider | Quirk | Impact |
|----------|-------|--------|
| GPT-5 | No `temperature` parameter | 400 error if included |
| GPT-5 | Uses `max_completion_tokens` not `max_tokens` | Silent truncation |
| Gemini 3 Pro | Only LOW and HIGH thinkingLevel | MEDIUM → 400 error |
| Gemini | No `responseMimeType` for streaming | JSON mode unavailable |
| Claude | `web_search` tool has max 5 uses per request | May hit limit on complex queries |

---

## 4. Version Pinning

**Current approach:** Model names hardcoded in `model-registry.js`. No version pinning system — models are referenced by their current name (e.g., `gemini-3.1-pro-preview`).

**Risk:** When Google/Anthropic/OpenAI deprecate a model name, the app breaks immediately.

---

## 5. Cost Comparison

| Model | Input Cost | Output Cost | Primary Use | Volume |
|-------|-----------|-------------|-------------|--------|
| Gemini 3.1 Pro | ~$1.25/1M tokens | ~$5.00/1M | Briefing (7 calls/snapshot) | HIGH |
| Claude Opus 4.6 | ~$15/1M tokens | ~$75/1M | Strategy (1-2 calls/snapshot) | LOW |
| GPT-5.4 | ~$2.50/1M tokens | ~$10/1M | Venue scoring (1 call/snapshot) | LOW |
| Haiku 4.5 | ~$0.25/1M tokens | ~$1.25/1M | Venue filter (1 call/request) | MEDIUM |
| Flash Lite | ~$0.075/1M tokens | ~$0.30/1M | Translation (many/ride) | HIGH |

**Cost driver:** Briefing pipeline is highest volume (7+ LLM calls per snapshot, all Gemini with Google Search). Strategy is highest per-call cost (Claude Opus) but low volume.

---

## 6. Migration Path When Models Deprecate

### Step 1: Identify Replacement

Check provider documentation for recommended successor model.

### Step 2: Test in Model Registry

Update `model-registry.js` with new model name. The adapter pattern means no other code changes needed — the adapter routes by name prefix.

### Step 3: Verify Provider Quirks

- Check if new model supports same features (search, vision, streaming, JSON mode)
- Verify parameter compatibility (temperature, maxTokens, thinkingLevel)
- Test with a single role first, then roll out

### Step 4: Update Fallback Chains

If the deprecated model was a fallback target in `getFallbackConfig()`, update the fallback model too.

### Step 5: Monitor

Watch for quality regressions via user feedback and error rates.

---

## 7. Current State

| Area | Status |
|------|--------|
| Model registry (26+ roles) | Working |
| Adapter pattern (4 providers) | Working |
| Environment overrides | Working |
| Cross-provider fallback | Working (HedgedRouter) |
| Model-specific quirk handling | Working |

---

## 8. Known Gaps

1. **No version pinning** — Model deprecation breaks the app immediately.
2. **No A/B testing** — Can't compare two models side-by-side with user feedback.
3. **No cost tracking** — No per-request or per-user cost monitoring.
4. **No quality benchmarks** — No automated evaluation of model output quality.
5. **No gradual rollout** — Model changes are all-or-nothing, not percentage-based.

---

## 9. TODO — Hardening Work

- [ ] **Add version pinning** — Map role → model with dated version strings
- [ ] **A/B testing framework** — Route X% of requests to model B, compare feedback
- [ ] **Cost tracking** — Log token counts per request, aggregate per user/role/day
- [ ] **Quality benchmarks** — Automated scoring of strategy, venue, and event quality
- [ ] **Gradual rollout** — Percentage-based model migration with automatic rollback on quality drop
- [ ] **Model deprecation alerts** — Monitor provider announcements, alert before deprecation dates

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/ai/model-registry.js` | Role → model mapping (763 lines) |
| `server/lib/ai/adapters/index.js` | Adapter routing + HedgedRouter |
| `server/lib/ai/adapters/anthropic-adapter.js` | Claude adapter |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini adapter |
| `server/lib/ai/adapters/openai-adapter.js` | OpenAI adapter |
