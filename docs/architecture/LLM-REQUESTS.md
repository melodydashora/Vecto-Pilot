# LLM-REQUESTS.md — Every AI/LLM API Call Path

> **Canonical reference** for every path in the codebase that results in an LLM/AI API call. For each: auth middleware, mid-request auth expiry behavior, API key location, and model used.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Adapter Architecture](#1-adapter-architecture)
2. [Model Registry](#2-model-registry)
3. [Rideshare Coach Chat](#3-ai-coach-chat)
4. [Strategy Generation](#4-strategy-generation)
5. [Briefing Pipeline LLM Calls](#5-briefing-pipeline-llm-calls)
6. [Public Concierge](#6-public-concierge)
7. [Offer Analysis (Siri Integration)](#7-offer-analysis-siri-integration)
8. [Translation](#8-translation)
9. [Text-to-Speech (TTS)](#9-text-to-speech-tts)
10. [Gemini Bridge (CLI Tool)](#10-gemini-bridge-cli-tool)
11. [Context Injection (Coach DAL)](#11-context-injection-coach-dal)
12. [API Keys](#12-api-keys)
13. [Current State](#13-current-state)
14. [Known Gaps](#14-known-gaps)
15. [TODO — Hardening Work](#15-todo--hardening-work)

---

## 1. Adapter Architecture

**File:** `server/lib/ai/adapters/index.js` (284 lines)

### Entry Points

```javascript
callModel(role, params)        // Non-streaming (returns full response)
callModelStream(role, params)  // Streaming (returns SSE-style chunks)
```

### Routing Flow

```
callModel('STRATEGY_TACTICAL', { system, user })
  │
  ├─ 1. Look up role in model-registry.js → get model config
  │     { model: 'claude-opus-4-6', provider: 'anthropic', features: [...] }
  │
  ├─ 2. Select adapter based on provider
  │     ├─ 'anthropic' → anthropic-adapter.js
  │     ├─ 'google'    → gemini-adapter.js
  │     ├─ 'openai'    → openai-adapter.js
  │     └─ 'vertex'    → vertex-adapter.js
  │
  ├─ 3. HedgedRouter for fallback
  │     If primary fails → try fallback provider (e.g., Google → OpenAI)
  │
  └─ 4. Adapter makes actual API call → return response
```

### Available Adapters

| Adapter | File | Provider | Key Models |
|---------|------|----------|------------|
| `anthropic-adapter.js` | `server/lib/ai/adapters/` | Anthropic | Claude Opus 4.6, Haiku 4.5 |
| `gemini-adapter.js` | `server/lib/ai/adapters/` | Google | Gemini 3.1 Pro Preview, Flash |
| `openai-adapter.js` | `server/lib/ai/adapters/` | OpenAI | GPT-5.4, O3/O4 reasoning |
| `vertex-adapter.js` | `server/lib/ai/adapters/` | Google Vertex | Available but not actively used |

### Hedged Router

**File:** `server/lib/ai/adapters/index.js` (lines 27–92)

Provides cross-provider fallback:
- Google primary → OpenAI (GPT-5.4) fallback
- Anthropic/OpenAI primary → Gemini Flash fallback

---

## 2. Model Registry

**File:** `server/lib/ai/model-registry.js` (763 lines)

### All Registered Roles

#### Briefing Roles (Gemini with Google Search)

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `BRIEFING_WEATHER` | gemini-3.1-pro-preview | search | Weather analysis |
| `BRIEFING_TRAFFIC` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | Traffic consolidation |
| `BRIEFING_NEWS` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | Rideshare news |
| `BRIEFING_EVENTS_DISCOVERY` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | Event discovery |
| `BRIEFING_SCHOOLS` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | School closures |
| `BRIEFING_AIRPORT` | gemini-3.1-pro-preview | search | Airport conditions |
| `BRIEFING_HOLIDAY` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | Holiday detection |
| `BRIEFING_FALLBACK` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | Fallback for failed calls |

#### Strategy Roles

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `STRATEGY_CORE` | claude-opus-4-6 | — | Core strategic plan |
| `STRATEGY_CONTEXT` | gemini-3.1-pro-preview | search, thinkingLevel=HIGH | Real-time context gathering |
| `STRATEGY_TACTICAL` | claude-opus-4-6 | — | 1-hour tactical consolidation |
| `STRATEGY_DAILY` | claude-opus-4-6 | — | 8–12hr daily strategy |

#### Venue/Ranking Roles

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `VENUE_SCORER` | gpt-5.4 | reasoningEffort=medium | Venue scoring |
| `VENUE_FILTER` | claude-haiku-4-5-20251001 | — | Fast venue classification |
| `VENUE_TRAFFIC` | gemini-3.1-pro-preview | — | Venue traffic analysis |
| `VENUE_EVENT_VERIFIER` | gemini-3.1-pro-preview | — | Event verification |

#### Coach/Conversation

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `AI_COACH` | gemini-3.1-pro-preview | streaming, search, vision, OCR | Rideshare Coach chat |

#### Concierge

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `CONCIERGE_SEARCH` | gemini-3.1-pro-preview | search, thinkingLevel=LOW | Venue/event search |
| `CONCIERGE_CHAT` | gemini-3.1-pro-preview | search, thinkingLevel=LOW | Public Q&A |

#### Utilities

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `UTIL_TRANSLATION` | gemini-3.1-flash-lite-preview | — | Driver-rider translation |
| `UTIL_RESEARCH` | gemini-3.1-pro-preview | search | General research |
| `UTIL_MARKET_PARSER` | gpt-5.4 | reasoningEffort=low | Market data parsing |

#### Offer Analysis

| Role | Model | Features | Purpose |
|------|-------|----------|---------|
| `OFFER_ANALYZER` | gemini-3-flash-preview | vision | Phase 1: <2s rapid decision |
| `OFFER_ANALYZER_DEEP` | gemini-3.1-pro-preview | thinkingLevel=LOW | Phase 2: async enrichment |

### Override Env Vars

- `AGENT_OVERRIDE_MODEL` — Override model for agent roles
- `AI_COACH_OVERRIDE_MODEL` — Override for Rideshare Coach (streaming-aware)

---

## 3. Rideshare Coach Chat

### Endpoint

**Route:** `POST /api/chat`
**File:** `server/api/chat/chat.js` (line 704)
**Auth:** `requireAuth`

### Flow

```
Client sends: { message, snapshotId, conversationHistory }
  │
  ├─ 1. requireAuth middleware validates token + session
  ├─ 2. Load complete context via Coach DAL (see Section 11)
  ├─ 3. Build system prompt with:
  │     ├─ Snapshot (location, weather, time, timezone)
  │     ├─ Strategy (ranked venues, pro tips)
  │     ├─ Briefing (events, traffic, news)
  │     ├─ User notes (previous coach observations)
  │     ├─ Market intelligence
  │     ├─ Zone intelligence (crowd-sourced)
  │     └─ Session history (last 10 sessions)
  │
  ├─ 4. callModelStream('AI_COACH', { system, messageHistory })
  │     └─ Routes to Gemini 3.1 Pro Preview (streaming)
  │     └─ Features: Google Search + Vision + OCR
  │
  ├─ 5. Stream response to client via SSE chunks
  ├─ 6. parseActions(response) — extract action tags
  └─ 7. executeActions() — save notes, deactivate events, etc.
```

### Mid-Request Auth Expiry

If auth expires during a streaming chat response:
- The stream continues (server already validated auth at the start)
- No mid-stream auth check
- Next request from client will fail with 401

### Action Tags

The Rideshare Coach can embed action tags in responses:
`SAVE_NOTE`, `DEACTIVATE_EVENT`, `REACTIVATE_EVENT`, `ADD_EVENT`, `UPDATE_EVENT`, `DEACTIVATE_NEWS`, `SYSTEM_NOTE`, `ZONE_INTEL`, `MARKET_INTEL`, `SAVE_VENUE_INTEL`

These are parsed and executed server-side after the response completes.

---

## 4. Strategy Generation

### Immediate/Tactical Strategy

**File:** `server/lib/ai/providers/consolidator.js` (lines 148–250+)
**Function:** `generateImmediateStrategy()`
**Triggered by:** `POST /api/blocks-fast` waterfall (Phase 2)
**Auth:** Inherited from blocks-fast endpoint (`requireAuth`)

```
runImmediateStrategy(snapshotId, { briefingRow })
  │
  ├─ Build prompt with:
  │   ├─ Driver address, coordinates, timezone
  │   ├─ Briefing data (traffic, events, weather, news, closures, airport)
  │   ├─ Time-of-day intelligence patterns
  │   └─ Output format: GO, AVOID, WHEN, WHY, IF NO PING, INTEL
  │
  ├─ callModel('STRATEGY_TACTICAL', { system, user: prompt })
  │   └─ Routes to Claude Opus 4.6
  │
  └─ Store in strategies.strategy_for_now
      └─ DB trigger fires → pg_notify('strategy_ready')
```

### Daily Strategy

**Function:** `runConsolidator()`
**Model:** `STRATEGY_DAILY` → Claude Opus 4.6
**Purpose:** 8–12 hour strategic planning

### Mid-Request Auth Expiry

Strategy generation runs server-side in the blocks-fast waterfall. Auth is validated once at the POST entry point. If session expires during the 60–90 second generation:
- Generation completes (no mid-pipeline auth check)
- Results are stored in DB
- Client receives 401 on next polling request
- Strategy data is available on re-login (same snapshot reuse window)

---

## 5. Briefing Pipeline LLM Calls

**File:** `server/lib/briefing/briefing-service.js` (3,103 lines)

All briefing LLM calls are made during `generateAndStoreBriefing()`, triggered by the blocks-fast waterfall. Auth is validated once at the waterfall entry point.

| Data Source | Role | Model | File Line | Features |
|-------------|------|-------|-----------|----------|
| Traffic analysis | `BRIEFING_TRAFFIC` | gemini-3.1-pro-preview | 495 | search, thinking=HIGH |
| News discovery | `BRIEFING_FALLBACK` / `BRIEFING_NEWS` | gemini-3.1-pro-preview | 542, 2256 | web_search (Claude) / search (Gemini) |
| Event discovery (×2) | `BRIEFING_EVENTS_DISCOVERY` | gemini-3.1-pro-preview | 995, 1166 | search, thinking=HIGH |
| School closures | `BRIEFING_SCHOOLS` | gemini-3.1-pro-preview | 1753 | search, thinking=HIGH |
| Airport conditions | `BRIEFING_AIRPORT` | gemini-3.1-pro-preview | 2126 | search |
| Holiday detection | `BRIEFING_HOLIDAY` | gemini-3.1-pro-preview | N/A | search, thinking=HIGH |

**Non-LLM data sources in the briefing:**
- Weather: Google Weather API (direct HTTP, no LLM)
- Traffic raw data: TomTom API (direct HTTP, LLM for analysis only)

### Mid-Request Auth Expiry

Same as strategy — all calls run server-side after initial auth validation. No mid-pipeline auth checks.

---

## 6. Public Concierge

### Search Endpoint

**Route:** `POST /api/concierge/p/:token/explore`
**File:** `server/api/concierge/concierge.js` (line 248)
**Auth:** Token-based validation (`validateShareToken`) — NOT `requireAuth`. Uses a share token from QR code.
**Rate Limit:** 5 req/min

```
Client sends: { lat, lng, filter, timezone }
  │
  ├─ 1. Validate share token (not JWT — QR-code-generated token)
  ├─ 2. Search DB first: discovered_events + venue_catalog
  ├─ 3. If < 3 results → callModel('CONCIERGE_SEARCH', { location, query })
  │     └─ Gemini 3.1 Pro with Google Search + thinkingLevel=LOW
  └─ 4. Store new discoveries, return venues + events
```

### Chat Endpoints

**Route:** `POST /api/concierge/p/:token/ask-stream` (streaming)
**Route:** `POST /api/concierge/p/:token/ask` (non-streaming)
**Auth:** Token-based (`validateShareToken`)
**Rate Limit:** 3 req/min

```
callModelStream('CONCIERGE_CHAT', { system, user: question })
  └─ Gemini 3.1 Pro with Google Search + thinkingLevel=LOW
```

### Mid-Request Auth Expiry

N/A — Concierge uses share tokens, not user JWT. Share tokens don't expire (they're static URLs).

### Security Notes

- PII leak fix (H-2): Phone number removed from public concierge profile
- User-supplied context sanitized before injection
- Rate limiting prevents abuse

---

## 7. Offer Analysis (Siri Integration)

### Phase 1: Rapid Decision (<2 seconds)

**Route:** `POST /api/hooks/analyze-offer`
**File:** `server/api/hooks/analyze-offer.js` (line 138)
**Auth:** **NONE** — Siri Shortcuts cannot send JWT. Public endpoint.
**Rate Limit:** Not documented (relies on device_id tracking)

```
Siri sends: multipart form-data { screenshot, device_id, lat, lng }
  │
  ├─ 1. Parse image via multer
  ├─ 2. callModel('OFFER_ANALYZER', { image, tier-specific prompt })
  │     └─ Gemini 3 Flash Preview (Vision) — ULTRA FAST (<1s)
  │
  └─ 3. Return { price, per_mile, decision: ACCEPT|REJECT, reason }
       └─ Must complete in <3s (Siri timeout for trip radar)
```

### Phase 2: Deep Analysis (Async)

**Triggered:** Fire-and-forget after Phase 1 returns
**Model:** `OFFER_ANALYZER_DEEP` → Gemini 3.1 Pro Preview (thinkingLevel=LOW)
**Purpose:** Rich reasoning — location analysis, deadhead assessment, confidence scoring
**Storage:** `offer_intelligence` table

### Mid-Request Auth Expiry

N/A — No auth on this endpoint.

### Security Concern

This endpoint is **completely unauthenticated**. Any client with the URL can submit images for analysis. Currently relies on obscurity (not linked in UI, only Siri Shortcuts know the URL).

---

## 8. Translation

**Route:** `POST /api/translate`
**File:** `server/api/translate/` (line 28)
**Auth:** `requireAuth`

```
Client sends: { text, sourceLang, targetLang }
  │
  ├─ callModel('UTIL_TRANSLATION', { system: translationPrompt, user: text })
  │   └─ Gemini 3.1 Flash Lite Preview (fastest, cheapest)
  │
  └─ Return { translatedText, detectedLang, targetLang, confidence }
```

**Supported languages:** English, Spanish, Polish, Ukrainian, Swedish, Albanian, Portuguese, French, German, Japanese, Korean, Arabic, Hindi, Mandarin, Italian, Russian, Turkish, Vietnamese, Thai, Filipino/Tagalog.

**Optimized for:** FIFA World Cup 2026 demographics.

### Mid-Request Auth Expiry

Translation is a single fast call (~500ms). If auth expired just before the call, the middleware catches it. If auth expires during the call, the response completes normally.

---

## 9. Text-to-Speech (TTS)

**Route:** `POST /api/tts`
**File:** `server/api/chat/tts.js` (line 17)
**Auth:** `requireAuth`

```
Client sends: { text, language? }
  │
  ├─ OpenAI TTS API (NOT an LLM — speech synthesis)
  │   └─ Model: tts-1-hd
  │   └─ Voice: 'nova' (most languages) or 'alloy' (English)
  │
  └─ Return: MP3 audio buffer (~200ms latency)
```

**API Key:** `OPENAI_API_KEY` (shared with GPT-5 calls)

---

## 10. Gemini Bridge (CLI Tool)

**File:** `scripts/ask-gemini.mjs`
**Auth:** N/A — runs locally via CLI, uses `GEMINI_API_KEY` directly
**SDK:** `@google/genai` (direct, not via server adapters)

```bash
node scripts/ask-gemini.mjs "your question"          # One-shot
node scripts/ask-gemini.mjs --file path "analyze"     # With file context
node scripts/ask-gemini.mjs --image screenshot.png     # Vision
node scripts/ask-gemini.mjs --thread name "follow-up"  # Multi-turn
```

**Purpose:** Claude Code delegates tasks to Gemini for:
- Large-context analysis (1M tokens)
- Live web knowledge (Google Search)
- Vision/screenshot analysis
- Second opinion on design decisions

**Not auto-JSON mode** — unlike server adapter. Thread history stored in `.gemini-threads/` (gitignored).

---

## 11. Context Injection (Coach DAL)

**File:** `server/lib/ai/coach-dal.js`

**Function:** `getCompleteContext(snapshotId)` builds the full data payload injected into AI prompts.

### Data Sources

| Data | Source | Injected Into |
|------|--------|---------------|
| Location (lat/lng/city/state/address) | `snapshots` table | Coach, Strategy |
| Weather, air quality | `snapshots.weather`, `snapshots.air` | Coach, Strategy |
| Time context (dow, hour, day_part_key, timezone) | `snapshots` table | Coach, Strategy |
| Strategy (status, summary, tactical forecast) | `strategies` table | Coach |
| Briefing (traffic, weather, events, news) | `briefings` table | Coach, Strategy |
| Ranked venues (25 recommendations) | `rankings` + `smart_blocks` | Coach |
| Driver profile (name, home, vehicle) | `driver_profiles` + `driver_vehicles` | Coach |
| Market intelligence | `market_intelligence` | Coach |
| User notes | `user_intel_notes` | Coach |
| Zone intelligence (honey holes, dead zones) | `zone_intelligence` | Coach |
| Session history (last 10 sessions) | `coach_conversations` | Coach |

**`formatContextForPrompt()`** converts this into readable markdown for injection into the system prompt.

---

## 12. API Keys

All read from `process.env`. No values stored in code.

| Env Var | Provider | Used By | File |
|---------|----------|---------|------|
| `ANTHROPIC_API_KEY` | Anthropic | Claude Opus 4.6, Haiku 4.5 | `anthropic-adapter.js:83` |
| `OPENAI_API_KEY` | OpenAI | GPT-5.4, O3/O4, TTS | `openai-adapter.js:33`, `tts-handler.js:6` |
| `GEMINI_API_KEY` | Google | Gemini 3.1 Pro, Flash, Flash Lite | `gemini-adapter.js:115+` |
| `GOOGLE_MAPS_API_KEY` | Google | Weather API, Air Quality (concierge) | `concierge.js:182` |
| `GOOGLEAQ_API_KEY` | Google | Air Quality API (concierge) | `concierge.js:208` |
| `JWT_SECRET` | Internal | Token signing/verification | `auth.js:41`, `auth.js:75` |
| `VECTO_AGENT_SECRET` | Internal | Service account auth | `middleware/auth.js:42` |
| `TOMTOM_API_KEY` | TomTom | Traffic data | `lib/traffic/tomtom.js` |
| `GOOGLE_CLIENT_ID` | Google | OAuth | `auth.js` |
| `GOOGLE_CLIENT_SECRET` | Google | OAuth | `auth.js` |
| `UBER_CLIENT_ID` | Uber | OAuth (platform data) | `uber-oauth.js` |
| `UBER_CLIENT_SECRET` | Uber | OAuth (platform data) | `uber-oauth.js` |
| `SENDGRID_API_KEY` | SendGrid | Password reset emails | `lib/auth/email.js` |
| `TWILIO_ACCOUNT_SID` | Twilio | Password reset SMS | `lib/auth/sms.js` |
| `TWILIO_AUTH_TOKEN` | Twilio | Password reset SMS | `lib/auth/sms.js` |

### Health Check

**File:** `model-registry.js` `getLLMDiagnostics()` (line 725–751) checks for presence of `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.

---

## 13. Current State

| Path | Auth | Model | Status |
|------|------|-------|--------|
| Rideshare Coach chat | `requireAuth` | Gemini 3.1 Pro (streaming) | Working |
| Tactical strategy | `requireAuth` (via waterfall) | Claude Opus 4.6 | Working |
| Daily strategy | `requireAuth` (via waterfall) | Claude Opus 4.6 | Working |
| Briefing (7 LLM calls) | `requireAuth` (via waterfall) | Gemini 3.1 Pro (search) | Working |
| Concierge search | Share token | Gemini 3.1 Pro (search) | Working |
| Concierge chat | Share token | Gemini 3.1 Pro (search) | Working |
| Offer analysis (Phase 1) | **None** | Gemini 3 Flash (vision) | Working |
| Offer analysis (Phase 2) | **None** | Gemini 3.1 Pro | Working |
| Translation | `requireAuth` | Gemini Flash Lite | Working |
| TTS | `requireAuth` | OpenAI tts-1-hd | Working |
| Venue scoring | `requireAuth` (via waterfall) | GPT-5.4 | Working |
| Venue filtering | `requireAuth` (via waterfall) | Claude Haiku 4.5 | Working |
| Gemini bridge (CLI) | N/A (local) | Gemini 3.1 Pro | Working |

---

## 14. Known Gaps

1. **Offer analysis endpoint is unauthenticated** — Any client can submit images for AI analysis. Should require device_id registration or API key.

2. **No mid-pipeline auth validation** — The blocks-fast waterfall runs 60–90 seconds with no auth recheck. If session expires mid-pipeline, results are stored but client can't retrieve them until re-login.

3. **No LLM call budgeting** — No per-user limits on AI calls. A user could spam the Coach chat endpoint (rate limit is global, not per-user-per-endpoint).

4. **No LLM response caching** — Each briefing generation makes 7+ LLM calls. If two users are near the same location, the same events/traffic/news queries run independently.

5. **Vertex AI adapter is unused** — Available but no roles route through it. Dead code unless there's a planned migration.

6. **No fallback monitoring** — When the HedgedRouter falls back to a secondary provider, there's no alert or metric. Silent degradation.

7. **Context injection can exceed token limits** — `getCompleteContext()` assembles all data unconditionally. For users with many notes/sessions, the context could exceed model limits.

8. **TTS and translation share OpenAI key** — If the key is rate-limited or revoked for one use case, both break.

9. **News primary source (Claude web_search) is expensive** — Anthropic charges for web_search tool use. This runs on every briefing generation.

---

## 15. TODO — Hardening Work

- [ ] **Add auth to offer analysis** — Require device registration or API key. At minimum, rate-limit by IP
- [ ] **Add per-user LLM call budget** — Track calls per user per hour. Enforce limits on Coach chat (e.g., 50 messages/hour)
- [ ] **Add LLM response caching** — Cache briefing data by coord_key + time window. Share across nearby users
- [ ] **Remove or use Vertex adapter** — Either route roles through it or delete the dead code
- [ ] **Add fallback monitoring** — Log + alert when HedgedRouter activates. Track primary vs fallback usage
- [ ] **Add context size estimation** — Before calling LLM, estimate token count. Truncate least-important sections if over limit
- [ ] **Separate TTS API key** — Use a dedicated OpenAI API key for TTS to isolate rate limits
- [ ] **Add LLM call logging/observability** — Centralized log of every LLM call: role, model, latency, token usage, cost estimate
- [ ] **Evaluate news source costs** — Compare Claude web_search cost vs. NewsAPI.org subscription for briefing news
- [ ] **Add circuit breaker per provider** — If Anthropic is down, stop routing to it after N failures (HedgedRouter helps but isn't a full circuit breaker)
- [ ] **Add mid-pipeline auth check** — On long-running pipelines (>30s), verify session is still valid before making the next LLM call

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/ai/adapters/index.js` | Adapter router, `callModel()`, HedgedRouter |
| `server/lib/ai/model-registry.js` | All role→model mappings (763 lines) |
| `server/lib/ai/adapters/anthropic-adapter.js` | Claude API calls |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini API calls |
| `server/lib/ai/adapters/openai-adapter.js` | OpenAI API calls |
| `server/lib/ai/unified-ai-capabilities.js` | Health monitoring |
| `server/api/chat/chat.js` | Rideshare Coach chat endpoint |
| `server/lib/ai/providers/consolidator.js` | Strategy generation LLM calls |
| `server/lib/briefing/briefing-service.js` | Briefing pipeline LLM calls (3,103 lines) |
| `server/api/concierge/concierge.js` | Public concierge endpoints |
| `server/lib/concierge/concierge-service.js` | Concierge search + chat logic |
| `server/api/hooks/analyze-offer.js` | Offer analysis (Siri) |
| `server/api/translate/` | Translation endpoint |
| `server/api/chat/tts.js` | TTS endpoint |
| `server/lib/ai/coach-dal.js` | Context injection for AI prompts |
| `scripts/ask-gemini.mjs` | CLI bridge to Gemini |
