# FUTURE.md — Future Roadmap and Planned Features

> **Canonical reference** for planned features, TODOs consolidated from all architecture docs, and strategic direction.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/feature-management.md` — Feature flags and A/B testing (absorbed into CONVERSION.md §4)

---

## Table of Contents

1. [Active Coach Inbox Items](#1-active-coach-inbox-items)
2. [Google OAuth Status](#2-google-oauth-status)
3. [Mobile App Plans](#3-mobile-app-plans)
4. [Consolidated TODOs from All Docs](#4-consolidated-todos-from-all-docs)
5. [Feature Priorities](#5-feature-priorities)

---

## 1. Active Coach Inbox Items

Source: `docs/coach-inbox.md` (updated 2026-04-10)

### HIGH Priority

| Feature | Description |
|---------|-------------|
| **AI-Gatekeeper Architecture** | Gemini pre-verifies all raw API data before UI to prevent hallucinations |
| **Native Swift/Android Wrapper** | Background service keeps AI connection alive (browser tabs suspend) |
| **PredictHQ Event Integration** | Replace HTML scraping with proper event demand API |
| **Live Context Payload for Chat** | Bypass heavy snapshot; append lat/lng/time directly to AI messages |
| **Market Exit Warning (Code 6)** | Map hard market boundaries, warn on exit (prevent "Waco Trap") |
| **Text-to-Speech (Voice Output)** | Hear strategy updates while driving |
| **Offer Intelligence Parsing** | Fix vehicle_mode and price data not passing to AI |
| **Client-Side Image Compression** | Prevent "Payload Too Large" errors on AI chat |

### MEDIUM Priority

| Feature | Description |
|---------|-------------|
| **AI-Driven Intel Tab (Market Map)** | Dynamic map with tactical zones (Red/Green/Yellow) |
| **Reject Reason Codes + Desperation Dial** | 1-5 codes for fast reject + adaptive acceptance strictness |
| **Ghost Toll Detection** | Physics-based: speed > 50mph implies tolls |
| **Concierge QR Code** | Backseat amenities/tips guide for tip boost |
| **Multimodal Vision Heatmap** | Screenshot uploader for AI heatmap analysis |
| **Dynamic Time-Aware Concierge** | Morning/Afternoon/Night context-aware prompts |

---

## 2. Google OAuth Status

**Status: FULLY IMPLEMENTED** (2026-02-13)

**Implementation:**
- `GET /api/auth/google` → Redirect to Google consent screen
- `POST /api/auth/google/exchange` → Exchange code for tokens
- CSRF protection via state tokens (10-min expiry, one-time use)
- ID token verification via `google-auth-library`
- New user creation with `profile_complete = false`
- Existing user linking (first Google login for email/password user)

**Known gap:** New OAuth users have `profile_complete = false` but the client does NOT enforce profile completion (no redirect to finish setup). Vehicle, address, and preferences may be missing.

**Apple OAuth: NOT IMPLEMENTED** — Stub returns 501. Required for iOS App Store submission.

---

## 3. Mobile App Plans

**From coach-inbox.md (HIGH priority):**

**Problem:** Web browsers suspend background tabs when driver switches to Uber/Lyft app. This kills WebSocket/SSE connections, causing:
- AI Coach connection drops during active driving
- SSE events missed (strategy_ready, blocks_ready, briefing_ready)
- Session restore required on every return (15-30s delay)

**Planned solution:** Wrap React frontend in native Swift (iOS) + Android shell with a background service that keeps the AI connection alive continuously.

**Status:** Not started. Critical for production reliability.

---

## 4. Consolidated TODOs from All Docs

### AUTH.md

- [ ] Add dedicated auth rate limiter (10 login/min per IP)
- [ ] Implement token refresh (short-lived access + refresh token)
- [ ] Migrate to standard JWT (add exp, iat, iss, aud)
- [ ] Add email verification on registration
- [ ] Enforce OAuth profile completion
- [ ] Implement Apple OAuth
- [ ] Add session cleanup job (cron for >2hr sessions)
- [ ] Add concurrent session management
- [ ] Auth event audit log

### SNAPSHOT.md

- [ ] Snapshot retention policy (archive >90 days)
- [ ] Validate formatted_address on creation
- [ ] Apply requireSnapshotOwnership consistently
- [ ] Remove client-side fallback snapshot creation
- [ ] Track enrichment history

### BRIEFING.md

- [ ] Per-source SSE events (weather_ready, traffic_ready)
- [ ] TomTom quota monitoring + alerting
- [ ] Cache school closures (24hr by coord_key)
- [ ] Dedicated news API (not LLM discovery)
- [ ] Place_id-based event dedup
- [ ] SSE reconnection with backoff

### SSE.md

- [ ] Client auto-reconnect (2s → 4s → 8s → 30s backoff)
- [ ] SSE auth (JWT as query param)
- [ ] Server-side snapshot filtering
- [ ] Connection health indicator in UI
- [ ] Per-user SSE channels

### LLM-REQUESTS.md

- [ ] Auth on offer analysis endpoint
- [ ] Per-user LLM call budget
- [ ] LLM response caching by coord_key
- [ ] Fallback monitoring + alerts
- [ ] Mid-pipeline auth check for long-running calls

### STRATEGY.md

- [ ] Inject driver preferences into strategy prompt
- [ ] Auto-generate 12HR strategy
- [ ] Strategy quality scoring
- [ ] Strategy diff on refresh
- [ ] Smarter briefing gate (partial data threshold)

### VENUES.md

- [ ] Integrate surge pricing into value scoring
- [ ] Venue freshness TTL (re-check hours >7 days)
- [ ] Driver preference-aware scoring
- [ ] Venue popularity from ride history
- [ ] Venue catalog cleanup job

### AI_RIDESHARE_COACH.md

- [ ] Context size estimation (token counting)
- [ ] Conversation summarization
- [ ] Per-user chat rate limit
- [ ] Unify voice and text on same model
- [ ] Coach proactive alerts

### LOUNGES_AND_BARS.md

- [ ] Google Popular Times integration
- [ ] Event-at-bar badges
- [ ] Cache Haiku classification per venue
- [ ] Happy hour data
- [ ] Track ride production per venue

### USER_PREFERENCES.md

- [ ] Preferences in strategy prompt
- [ ] Preferences in venue scoring
- [ ] Enforce OAuth profile completion
- [ ] Schedule preferences
- [ ] Auto-learn from behavior

### CONCIERGE.md

- [ ] Token expiration (optional TTL)
- [ ] Concierge analytics
- [ ] Multi-language concierge
- [ ] Link feedback to rides

### MAP.md

- [ ] Render zones on map (honey_holes, dead_zones)
- [ ] Continuous GPS tracking (5-min refresh)
- [ ] PostGIS for spatial queries
- [ ] Geofence alerts
- [ ] Heatmap overlay

### MARKET_INTELLIGENCE.md

- [ ] Live surge API integration
- [ ] Automate ETL pipeline
- [ ] Time-decay confidence
- [ ] Inject MI into strategy prompt
- [ ] Data quality dashboard

### SECURITY.md

- [ ] Auth on offer analysis
- [ ] Dedicated auth rate limiter
- [ ] Per-user rate limiting
- [ ] Standard JWT migration
- [ ] DOMPurify for HTML sanitization
- [ ] API key rotation mechanism
- [ ] Auth on location utility endpoints
- [ ] Remove unsafe-inline from CSP
- [ ] Security audit log
- [ ] WAF evaluation

### DB_SCHEMA.md

- [ ] Automated DB backups
- [ ] Table partitioning (snapshots, conversations)
- [ ] Read replica for analytics
- [ ] Row-level security
- [ ] Index audit

### TEST_STRATEGY.md

- [ ] CI/CD pipeline
- [ ] Coverage reporting (60% minimum)
- [ ] LLM mock framework
- [ ] SSE test harness
- [ ] Load testing
- [ ] Auth integration tests

### AI_MODEL_UPDATE_STRATEGY.md

- [ ] Version pinning
- [ ] A/B testing framework
- [ ] Cost tracking per request
- [ ] Quality benchmarks
- [ ] Gradual model rollout

### AI_MODEL_ADAPTERS.md

- [ ] Streaming for all adapters (Claude, OpenAI)
- [ ] Local model adapter (Ollama/vLLM)
- [ ] Remove or use Vertex adapter
- [ ] Per-request token logging
- [ ] Shared circuit breaker (Redis)

### AI_BEST_PRACTICES.md

- [ ] Token counting before LLM call
- [ ] Response quality scoring
- [ ] Strict JSON retry
- [ ] Prompt versioning
- [ ] Hallucination detection (post-generation)

---

## 5. Feature Priorities

### P0 — Security Critical

1. Auth on offer analysis endpoint
2. Per-user rate limiting
3. Standard JWT migration

### P1 — User-Facing Impact

1. Native mobile app wrapper (SSE connection persistence)
2. Text-to-speech (voice output while driving)
3. Live context payload for chat (bypass snapshot latency)
4. Market exit warning

### P2 — Quality and Reliability

1. CI/CD test pipeline
2. SSE auto-reconnect
3. Per-source briefing SSE events
4. Driver preferences in strategy

### P3 — Scale and Cost

1. LLM response caching
2. Cost tracking per request
3. TomTom quota monitoring
4. DB table partitioning

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/coach-inbox.md` | Active feature requests and bugs |
| `docs/architecture/*.md` | All architecture docs with per-domain TODOs |
| `LESSONS_LEARNED.md` | Production mistakes to never repeat |
| `docs/DOC_DISCREPANCIES.md` | Open findings needing resolution |
