# ROI.md — Return on Investment Analysis

> **Canonical reference** for LLM cost analysis, infrastructure costs, revenue model, and cost optimization opportunities.
> Last updated: 2026-04-10

---

## Table of Contents

1. [LLM Cost Analysis](#1-llm-cost-analysis)
2. [Infrastructure Costs](#2-infrastructure-costs)
3. [Cost Per User Per Day](#3-cost-per-user-per-day)
4. [Cost Optimization Opportunities](#4-cost-optimization-opportunities)
5. [Revenue Model Analysis](#5-revenue-model-analysis)
6. [Break-Even Framework](#6-break-even-framework)
7. [Current State](#7-current-state)
8. [Known Gaps](#8-known-gaps)
9. [TODO — Hardening Work](#9-todo--hardening-work)

---

## 1. LLM Cost Analysis

### Per-Session Costs (One Snapshot Cycle)

A single user session (login → GPS → snapshot → strategy → blocks) triggers:

| Step | Role | Model | Est. Input Tokens | Est. Output Tokens | Est. Cost |
|------|------|-------|-------------------|-------------------|-----------|
| Traffic analysis | BRIEFING_TRAFFIC | Gemini 3.1 Pro | ~4,000 | ~2,000 | ~$0.015 |
| Events discovery (×2) | BRIEFING_EVENTS_DISCOVERY | Gemini 3.1 Pro | ~6,000 | ~4,000 | ~$0.028 |
| News | BRIEFING_NEWS | Gemini 3.1 Pro | ~3,000 | ~2,000 | ~$0.014 |
| School closures | BRIEFING_SCHOOLS | Gemini 3.1 Pro | ~3,000 | ~1,500 | ~$0.011 |
| Airport | BRIEFING_AIRPORT | Gemini 3.1 Pro | ~2,000 | ~1,000 | ~$0.008 |
| Holiday | BRIEFING_HOLIDAY | Gemini 3.1 Pro | ~1,000 | ~500 | ~$0.004 |
| **Briefing subtotal** | | | | | **~$0.08** |
| NOW strategy | STRATEGY_TACTICAL | Claude Opus 4.6 | ~8,000 | ~2,000 | ~$0.27 |
| Venue scoring | VENUE_SCORER | GPT-5.4 | ~6,000 | ~3,000 | ~$0.045 |
| Venue filter | VENUE_FILTER | Claude Haiku 4.5 | ~500 | ~100 | ~$0.0003 |
| Event verification | VENUE_EVENT_VERIFIER | Gemini 3.1 Pro | ~1,000 | ~500 | ~$0.004 |
| **Strategy+Venues subtotal** | | | | | **~$0.32** |
| **SESSION TOTAL** | | | | | **~$0.40** |

### Per-Chat-Message Costs

| Component | Model | Est. Cost |
|-----------|-------|-----------|
| Rideshare Coach message | Gemini 3.1 Pro (streaming) | ~$0.01–0.05 |
| With Google Search | +search tool calls | +$0.005 |

### Per-Translation Costs

| Component | Model | Est. Cost |
|-----------|-------|-----------|
| Translation (per phrase) | Gemini Flash Lite | ~$0.0001 |
| TTS (per phrase) | OpenAI TTS-1-HD | ~$0.0005 |
| **Per ride (20-30 phrases)** | | **<$0.01** |

### Per-Offer-Analysis Costs

| Component | Model | Est. Cost |
|-----------|-------|-----------|
| Phase 1 (Flash, rapid) | Gemini 3 Flash | ~$0.001 |
| Phase 2 (Pro, async) | Gemini 3.1 Pro | ~$0.005 |
| **Per offer** | | **~$0.006** |

### Daily Strategy (On-Demand)

| Component | Model | Est. Cost |
|-----------|-------|-----------|
| 12HR strategy | Claude Opus 4.6 | ~$0.30 |

---

## 2. Infrastructure Costs

### Fixed Costs (Monthly)

| Service | Plan | Est. Monthly Cost |
|---------|------|-------------------|
| Replit (hosting + DB) | Hacker/Pro plan | $7–25 |
| Google Maps Platform | Pay-as-you-go | ~$100–200 (at 1K sessions/month) |
| Domain (vectopilot.com) | Annual | ~$1/month |
| **Fixed subtotal** | | **~$110–225/month** |

### Variable API Costs (Per 1,000 Active Users/Month)

| API | Usage Pattern | Est. Cost/1K users/month |
|-----|---------------|--------------------------|
| Google Geocoding | 1 call/session | ~$5 |
| Google Routes | 6 calls/session (batch) | ~$30 |
| Google Places | 6 calls/session | ~$18 |
| Google Weather | 2 calls/session | ~$2 |
| Google Timezone | 1 call/session | ~$5 |
| TomTom Traffic | 1 call/session (2,500/day free) | Free (under quota) |
| LLM (Gemini/Claude/GPT) | ~$0.40/session | ~$400 |
| OpenAI TTS | Translation rides | ~$5 |
| **Variable subtotal** | | **~$465/1K users/month** |

---

## 3. Cost Per User Per Day

### Light User (1 session/day, 5 chat messages, 2 offers)

```
Session:        $0.40
Chat (5 msgs):  $0.15
Offers (2):     $0.012
Translation:    $0.00 (not all rides need it)
───────────────────────
Daily total:    ~$0.56/user/day
Monthly:        ~$17/user/month
```

### Heavy User (3 sessions/day, 20 chat messages, 10 offers, 2 translation rides)

```
Sessions (3):     $1.20
Chat (20 msgs):   $0.60
Offers (10):      $0.06
Translation (2):  $0.02
Daily strategy:   $0.30
───────────────────────
Daily total:      ~$2.18/user/day
Monthly:          ~$65/user/month
```

---

## 4. Cost Optimization Opportunities

### High Impact

| Optimization | Savings | Effort |
|-------------|---------|--------|
| **Cache briefing by coord_key** — Nearby users share same events/traffic/news | 40-60% of briefing costs | Medium |
| **Replace Claude Opus with Sonnet for strategy** — Similar quality, 5x cheaper | ~80% of strategy costs ($0.27→$0.05) | Low (config change) |
| **Batch venue scoring** — One VENUE_SCORER call for multiple users in same area | 30-50% of venue costs | Medium |

### Medium Impact

| Optimization | Savings | Effort |
|-------------|---------|--------|
| **Cache Google Places results** — 7-day TTL (already partially implemented) | 50% of Places API costs | Low |
| **Reduce news to daily batch** — Generate news once per market per day, not per user | 90% of news LLM costs | Medium |
| **School closures daily batch** — Same schools for all drivers in area | 95% of school closure costs | Low |

### Lower Impact

| Optimization | Savings | Effort |
|-------------|---------|--------|
| **Use Haiku for event verification** — Currently Gemini Pro | ~50% of verification cost | Low |
| **Client-side translation cache** — Cache common phrases in localStorage | 30-50% of translation costs | Low |

---

## 5. Revenue Model Analysis

### Proposed Pricing Tiers

| Tier | Price/Month | Features | Target User |
|------|------------|----------|-------------|
| **Free** | $0 | 1 session/day, 5 chat messages, basic briefing | Trial drivers |
| **Standard** | $9.99 | Unlimited sessions, 50 chat/day, offer analysis, translation | Part-time drivers |
| **Premium** | $19.99 | Everything + daily strategy, priority support, advanced intel | Full-time drivers |
| **Pro** | $29.99 | Everything + unlimited chat, custom thresholds, API access | Power users |

### Feature-to-Revenue Mapping

| Feature | Tier Required | Cost to Serve | Value to Driver |
|---------|--------------|---------------|-----------------|
| GPS + Snapshot | Free | ~$0.05 | Location awareness |
| Briefing (weather, events) | Free | ~$0.08 | Daily conditions |
| NOW Strategy | Standard | ~$0.27 | Tactical positioning |
| SmartBlocks (venues) | Standard | ~$0.05 | Earning optimization |
| Rideshare Coach chat | Standard | ~$0.03/msg | Personalized advice |
| Offer analysis | Standard | ~$0.006/offer | Accept/reject guidance |
| Translation | Standard | ~$0.01/ride | FIFA World Cup feature |
| 12HR Daily Strategy | Premium | ~$0.30 | Full-day planning |
| Concierge (passenger QR) | Premium | ~$0.02/use | Tip enhancement |
| Custom offer thresholds | Pro | $0 (config only) | Personalized automation |

---

## 6. Break-Even Framework

### At Standard Tier ($9.99/month)

```
Revenue per user:     $9.99/month
Cost per light user:  $17/month    → LOSS ($7/month)
Cost per heavy user:  $65/month    → LOSS ($55/month)

Break-even requires:
  - Cost optimization (caching + cheaper models): reduce to ~$8/month
  - OR raise price to $19.99+ for active users
  - OR usage caps: limit sessions to 2/day at Standard tier
```

### At Premium Tier ($19.99/month)

```
Revenue per user:     $19.99/month
Cost per light user:  $17/month    → PROFIT ($3/month)
Cost per heavy user:  $65/month    → LOSS ($45/month)

Break-even requires:
  - Hard caps on heavy usage
  - Caching to reduce per-session cost to ~$0.20
  - OR volume discounts from LLM providers
```

### Key Insight

The Claude Opus strategy call ($0.27/session) is the single largest per-session cost. Replacing with Claude Sonnet (~$0.05) or Gemini Pro (~$0.03) would dramatically improve unit economics, if quality is acceptable.

---

## 7. Current State

| Area | Status |
|------|--------|
| LLM cost tracking | NOT IMPLEMENTED (tokens stored, not converted to cost) |
| Infrastructure cost monitoring | NOT IMPLEMENTED |
| Revenue model | NOT IMPLEMENTED (no pricing, no payment) |
| Cost optimization (caching) | Partial (coords_cache, places_cache exist) |
| Usage metering per user | NOT IMPLEMENTED |

---

## 8. Known Gaps

1. **No cost tracking** — Token counts stored but never converted to dollar amounts.
2. **No usage metering** — Can't bill per-user or enforce tier limits.
3. **No payment integration** — No Stripe, no subscription management.
4. **Claude Opus dominates cost** — $0.27/session for strategy is disproportionate.
5. **No briefing sharing** — Every user generates their own briefing, even at same location.

---

## 9. TODO — Hardening Work

- [ ] **Add per-request cost calculation** — Map tokens × model price in logging pipeline
- [ ] **Add per-user usage dashboard** — Track sessions, chat messages, offers per user per day
- [ ] **Implement briefing caching** — Share briefings across users within same coord_key + time window
- [ ] **A/B test Claude Opus vs Sonnet for strategy** — Measure quality difference vs 5x cost savings
- [ ] **Implement pricing tiers** — Stripe integration, usage caps, subscription management
- [ ] **Add daily LLM cost alerts** — Notify if daily spend exceeds threshold
- [ ] **Batch school closures/news per market** — Generate once per market per day, serve to all users

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/ai/model-registry.js` | Model selection + token limits |
| `server/lib/ai/adapters/` | Where API calls happen (cost incurred) |
| `server/api/health/ml-health.js` | Token count aggregation |
| `server/middleware/rate-limit.js` | Rate limits (indirect cost control) |
