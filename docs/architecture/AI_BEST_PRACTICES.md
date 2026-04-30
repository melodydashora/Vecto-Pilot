# AI_BEST_PRACTICES.md — AI/LLM Usage Best Practices

> **Canonical reference** for prompt patterns, context management, cost optimization, error handling, and hallucination prevention as implemented in Vecto Pilot.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Model Selection by Task](#1-model-selection-by-task)
2. [Prompt Engineering Patterns](#2-prompt-engineering-patterns)
3. [Context Window Management](#3-context-window-management)
4. [Token Cost Optimization](#4-token-cost-optimization)
5. [Error Handling for LLM Failures](#5-error-handling-for-llm-failures)
6. [Fallback Strategies](#6-fallback-strategies)
7. [Response Validation](#7-response-validation)
8. [Hallucination Prevention](#8-hallucination-prevention)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Model Selection by Task

### Principle: Right Model for Right Job

| Task Complexity | Model Tier | Examples |
|----------------|------------|---------|
| **Simple classification** | Haiku / Flash Lite | Venue P/S/X classification, translation |
| **Structured generation** | GPT-5.4 (medium reasoning) | Venue scoring (JSON), market parsing |
| **Deep reasoning** | Claude Opus 4.6 | Strategy generation (synthesis of 7+ data sources) |
| **Search + reasoning** | Gemini Pro (HIGH thinking) | Briefing (events, traffic, news — needs web search) |
| **Ultra-fast vision** | Gemini Flash (vision) | Offer screenshot analysis (<2s for Siri) |
| **Streaming conversation** | Gemini Pro (streaming) | Rideshare Coach chat (requires SSE) |

### Feature Requirements Drive Selection

| Feature Needed | Available On |
|---------------|--------------|
| Google Search grounding | Gemini only |
| Vision/image analysis | Gemini (native), OpenAI (via API) |
| Extended thinking | Gemini (thinkingLevel), OpenAI (reasoningEffort) |
| Streaming SSE | Gemini (current implementation) |
| Web search tool | Anthropic (`web_search`), OpenAI (`gpt-5-search-api`) |

---

## 2. Prompt Engineering Patterns

### Pattern 1: Role-Based System Prompts

Strategy prompts define the AI's role explicitly:
```
"You are the Rideshare Strategist Dispatch Authority..."
```

### Pattern 2: Structured Output Enforcement

For JSON responses, two mechanisms:
1. **Gemini JSON mode:** Auto-detected from `json` keyword in prompt → sets `responseMimeType: 'application/json'`
2. **Anthropic assistant prefill:** Inject `"["` as assistant prefix to force JSON array start

### Pattern 3: Citation Suppression

When using Google Search, auto-injected to prevent markdown corruption:
```
"IMPORTANT: Do NOT include source citations, URLs, reference links, or markdown 
link syntax like [text](url) in your response."
```

### Pattern 4: Data Reduction Before Injection

Raw API data is compressed via optimization functions before prompt injection:
- `optimizeWeatherForLLM()` → 10+ fields → 1 sentence
- `optimizeNewsForLLM()` → 8 items → top 5 headlines
- `optimizeAirportForLLM()` → Full JSON → `travelImpact` summary
- `optimizeEventsForLLM()` → Standardized: 12h times, 6-decimal coords

### Pattern 5: Temporal Anchoring

All prompts include current date/time in driver's timezone. Events filtered to today only. News filtered to today + yesterday. Prevents temporal hallucination.

---

## 3. Context Window Management

### Token Budgets by Role

| Role | maxTokens | Reasoning |
|------|-----------|-----------|
| BRIEFING_* | 4,096–8,192 | Search results + analysis |
| STRATEGY_TACTICAL | 16,000 | Long-form synthesis (1-hour tactical) |
| VENUE_SCORER | 16,000 | Complex venue JSON |
| VENUE_FILTER | 300 | Single-character tier (P/S/X) |
| AI_COACH | 8,192 | Conversational response |
| UTIL_TRANSLATION | 512 | Short text translation |
| OFFER_ANALYZER | 1,024 | Quick decision |

### No Global Truncation

Each role has explicit `maxTokens`. No system-wide truncation or token counting. The Coach's context (11 data sources) is injected unconditionally — no size estimation before call.

---

## 4. Token Cost Optimization

### Strategy: Cheap Models for Simple Tasks

| Task | Model | Why Not Expensive? |
|------|-------|--------------------|
| Venue classification (P/S/X) | Haiku ($0.25/1M in) | Single-letter output, no reasoning needed |
| Translation | Flash Lite ($0.075/1M in) | Text-to-text, high volume |
| Offer analysis Phase 1 | Flash ($0.15/1M in) | <2s decision, vision-only |

### Strategy: Data Reduction

Instead of sending raw TomTom traffic JSON (5-10KB) to the LLM, the `optimizeWeatherForLLM()` pattern reduces it to a 50-word `driverImpact` string. This saves ~95% of input tokens across all strategy calls.

### Strategy: Cached Results

- Weather, events, school closures: Fetched once in briefing, reused across strategy and coach
- Venue catalog: DB-first discovery avoids redundant Google Places + LLM calls
- Strategy: Cached in localStorage, skip regeneration on app resume

---

## 5. Error Handling for LLM Failures

### Error Classification

**File:** `server/lib/ai/router/error-classifier.js`

| Error | Action |
|-------|--------|
| 429 (rate limit) | Don't retry, trip circuit breaker |
| 503 (server error) | Retry with fallback model |
| Timeout (120s) | Retry with fallback |
| 4xx (client error) | Don't retry (fix the request) |
| Network error | Retry with fallback |

### Circuit Breaker

5 consecutive failures → circuit opens for 60s. During open circuit, all requests to that provider skip immediately to fallback.

### Graceful Degradation

- Briefing: If one data source fails, others still complete. Partial briefing stored.
- Strategy: If briefing incomplete after 90s, proceeds with warning (not empty).
- Venues: If VENUE_SCORER times out, existing cached venues may still be available.
- Coach: If streaming fails, error message shown to user (not silent failure).

---

## 6. Fallback Strategies

### Cross-Provider Fallback (HedgedRouter)

Primary and fallback execute concurrently. First success wins.

| If Primary Fails | Fallback To |
|------------------|-------------|
| Google (Gemini) | OpenAI (GPT-5.4) |
| Anthropic (Claude) | Google (Gemini Flash) |
| OpenAI (GPT) | Google (Gemini Flash) |

### Same-Provider Fallback

Gemini 503 → try previous generation (e.g., `gemini-3.1-pro-preview` → `gemini-3-pro-preview`).

### No Fallback (Excluded)

- `OFFER_ANALYZER`: Vision-based, no non-vision fallback available
- `AI_COACH`: Streaming-only, no non-Gemini streaming implementation

---

## 7. Response Validation

### JSON Parsing Pipeline

1. Check if response is wrapped in markdown code blocks → strip
2. Check if response has prose preamble before JSON → strip
3. `JSON.parse()` → success → return
4. Parse failure → log warning, return raw text (no exception)

### Event Validation (13 Hard Rules)

**File:** `server/lib/events/pipeline/validateEvent.js`

1. Title required, non-empty, no TBD/Unknown
2. Venue OR address required, no TBD/Unknown
3. Start time required, no TBD/Unknown
4. End time required, no TBD/Unknown
5. Start date required, YYYY-MM-DD format
6. Category from allowed list
7. Date must be today or yesterday only

Fuzzy rescue: If category unmapped, try `normalizeCategory()` before rejecting.

### Zod Validation (Coach Actions)

All 11 action tag types validated via Zod schemas before DB write. Invalid actions are skipped and reported in `actions_result.errors`.

---

## 8. Hallucination Prevention

### Architectural Decision: "Coordinates from Google or DB, Never from AI"

**File:** `docs/architecture/decisions.md`

LLM-generated coordinates are never trusted for driver navigation. All venue locations come from:
1. Google Places API (`place_id` → verified lat/lng)
2. `venue_catalog` database (previously verified)
3. Google Geocoding API (address → coordinates)

### place_id Verification

Only place_ids starting with `ChIJ` prefix are valid Google Places IDs. Others are set to null.

### formatted_address Requirement

LLMs cannot reverse geocode. The `formatted_address` field must be present in every snapshot. Without it, strategy generation produces location-unaware advice.

### Today-Only Events

Event validation rejects future-dated events as noise. If Gemini returns events for next week when asked for "today's events," those are filtered as hallucinations.

### News Freshness Filter

News older than 2 days is discarded. Prevents LLM from citing stale or fabricated articles.

### Deactivated Content Filtering

User-dismissed news and events are filtered before prompt injection. Prevents LLM from recommending content the user has already rejected.

---

## 9. Current State

| Area | Status |
|------|--------|
| Model selection by task complexity | Working — 6 tiers |
| Data reduction before prompts | Working — 4 optimization functions |
| JSON mode (Gemini) | Working — auto-detected |
| Citation suppression | Working — auto-injected |
| Cross-provider fallback | Working — 9 roles enabled |
| Circuit breaker | Working — 5-failure threshold |
| Event validation (13 rules) | Working |
| Coach action Zod validation | Working |
| Coordinate verification | Working — Google/DB only |
| News/event freshness | Working |

---

## 10. Known Gaps

1. **No token counting before LLM call** — Context size unknown until call completes.
2. **No response quality scoring** — No automated evaluation of output quality.
3. **No per-request cost logging** — Token usage not tracked.
4. **JSON parsing is best-effort** — If LLM returns malformed JSON, raw text is used silently.
5. **No prompt versioning** — Prompts are inline in code, not versioned or A/B tested.
6. **Coach context injected unconditionally** — Power users with 100+ notes could exceed context limits.

---

## 11. TODO — Hardening Work

- [ ] **Add token counting** — Estimate context size before LLM call, truncate if over budget
- [ ] **Response quality scoring** — Heuristic scoring: does output reference real data? Correct format?
- [ ] **Per-request cost logging** — Track tokens in/out per call for cost monitoring
- [ ] **Strict JSON validation** — If JSON parsing fails, retry with explicit "return valid JSON" instruction
- [ ] **Prompt versioning** — Extract prompts to versioned files, enable A/B testing
- [ ] **Context budget management** — Prioritize context sections, drop least important if over limit
- [ ] **Hallucination detection** — Post-generation check: verify venue names and place_ids against DB

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/ai/model-registry.js` | Model selection config |
| `server/lib/ai/providers/consolidator.js` | Data reduction + prompt construction |
| `server/lib/ai/adapters/gemini-adapter.js` | JSON mode, citation suppression |
| `server/lib/events/pipeline/validateEvent.js` | Hallucination prevention (13 rules) |
| `server/api/rideshare-coach/validate.js` | Zod action validation |
| `server/lib/ai/router/error-classifier.js` | Error handling |
| `server/lib/ai/router/hedged-router.js` | Cross-provider fallback |
