# FEASIBILITY.md — Technical Feasibility Assessment

> **Canonical reference** for scalability limits, mobile feasibility, offline capability, third-party dependencies, and team size requirements.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Current Architecture Scalability Limits](#1-current-architecture-scalability-limits)
2. [PostgreSQL Scaling Path](#2-postgresql-scaling-path)
3. [LLM Rate Limits and Quotas](#3-llm-rate-limits-and-quotas)
4. [Mobile App Feasibility](#4-mobile-app-feasibility)
5. [Offline Capability Assessment](#5-offline-capability-assessment)
6. [Third-Party API Dependencies and SLAs](#6-third-party-api-dependencies-and-slas)
7. [Real-Time Data Freshness Constraints](#7-real-time-data-freshness-constraints)
8. [Team Size Requirements by Phase](#8-team-size-requirements-by-phase)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Current Architecture Scalability Limits

### Concurrent User Estimates

| Bottleneck | Current Limit | At Limit | Breaking Point |
|-----------|---------------|----------|---------------|
| DB connections | 25 (8-11 per active user) | ~2-3 concurrent users | Queue builds, timeouts |
| LLM concurrent calls | 10/provider (concurrency gate) | ~10 concurrent sessions | LLM queue backs up |
| SSE connections | ~1,000 (OS file descriptor limit) | Memory pressure | Node.js OOM |
| Rate limiting | 100/min/IP (global) | Shared IPs throttled | 429 for legitimate users |
| Server process | Single Node.js (no clustering) | CPU-bound at ~50 concurrent | Slow responses |

### Realistic Capacity (Current Architecture)

- **Comfortable:** 5-10 concurrent active users
- **Stressed:** 10-25 concurrent users (DB pool saturation, LLM queuing)
- **Breaking:** 25+ concurrent users (timeouts, 503s)

---

## 2. PostgreSQL Scaling Path

| Phase | Users | Action |
|-------|-------|--------|
| **Current** | 1-10 | Single instance, 25 connections |
| **Phase 1** | 10-100 | Increase pool to 50, add read replica for analytics/intel queries |
| **Phase 2** | 100-1K | PgBouncer for connection pooling, table partitioning (snapshots, coach_conversations by month) |
| **Phase 3** | 1K-10K | Managed PostgreSQL (AWS RDS, Cloud SQL), multi-AZ |
| **Phase 4** | 10K+ | Sharding by market, regional DB instances |

---

## 3. LLM Rate Limits and Quotas

| Provider | Known Limits | Current Usage | Risk |
|----------|-------------|---------------|------|
| **Gemini** | Varies by tier (free: 15 RPM, paid: 1000+ RPM) | 18+ roles, 7+ calls/session | Medium — primary provider |
| **Claude** | 4000 RPM (Opus), 8000 (Sonnet) | 2-3 calls/session (strategy) | Low — few calls, high token |
| **OpenAI** | Varies (GPT-5: ~500 RPM) | 1-2 calls/session (venue, TTS) | Low |
| **TomTom** | 2,500/day (free tier) | 1 call/session | Medium — 2,500 sessions/day max |
| **Google Maps** | $200 free credit/month, then pay-per-use | ~10 calls/session | Medium at scale |

---

## 4. Mobile App Feasibility

### PWA vs Native Assessment

| Capability | PWA (Current Web) | Native (Swift/Kotlin) |
|-----------|-------------------|----------------------|
| Background execution | No — browser suspends tabs | Yes — background service |
| SSE persistence | Unreliable (tab suspend) | Reliable (background process) |
| Push notifications | Limited (Web Push) | Full (APNs/FCM) |
| Siri Shortcuts | Via HTTP (current) | Native integration (SiriKit) |
| Offline | sessionStorage only (15 min) | Full offline-first with SQLite |
| GPS tracking | While tab active only | Continuous background |
| Biometric auth | Limited (WebAuthn) | Full (Face ID, fingerprint) |
| App Store presence | No | Yes (required for iOS distribution) |

### Recommendation: **Native wrappers (WebView + native bridges) as first step, full native later.**

A thin native shell (Swift + Kotlin) wrapping the React web app would solve the critical background execution problem without full rewrite. Native bridges handle: background SSE, push notifications, biometric auth.

---

## 5. Offline Capability Assessment

### Currently Available Offline

| Data | Storage | TTL | Restores |
|------|---------|-----|----------|
| Snapshot (location, weather) | sessionStorage | 15 min | Display data only |
| Strategy text | localStorage | Until snapshot changes | Strategy card |
| Chat history | localStorage | Indefinite | Chat thread |

### NOT Available Offline

- Fresh GPS location
- AI Coach chat (requires API)
- Briefing data (requires server)
- Venue recommendations (requires LLM)
- Offer analysis (requires Gemini Vision)
- Translation (requires LLM + TTS)

### Offline-First Feasibility

**Verdict: Limited.** The core value proposition requires real-time AI processing. Offline mode could provide: cached strategy display, cached venue list, pre-downloaded quick phrases for translation, and cached briefing data — but no new intelligence.

---

## 6. Third-Party API Dependencies and SLAs

| Service | Criticality | If Down... | Fallback | SLA |
|---------|------------|------------|----------|-----|
| **Replit** (hosting) | Critical | Total outage | None | Best-effort |
| **Replit Helium** (PostgreSQL) | Critical | Total outage | None | Best-effort |
| **Google Gemini** | Critical | No briefing, no coach, no events | HedgedRouter → OpenAI for some roles; Coach has no fallback | 99.9% (paid tier) |
| **Anthropic Claude** | High | No strategy generation | Gemini Flash fallback (quality loss) | 99.9% |
| **OpenAI** | Medium | No venue scoring, no TTS | Gemini fallback for venues; no TTS fallback | 99.9% |
| **Google Maps** | High | No geocoding, no routes, no places | Coords cache provides partial coverage | 99.9% |
| **Google Weather** | Medium | No weather data | Cached weather from last snapshot | N/A |
| **TomTom** | Medium | No traffic data | Gemini search-based traffic analysis | 99.95% |
| **Twilio** | Low | No SMS password reset | Email reset still works | 99.95% |
| **SendGrid** | Low | No email password reset | SMS reset still works | 99.95% |

---

## 7. Real-Time Data Freshness Constraints

| Data | Freshness | Update Trigger | Staleness Risk |
|------|-----------|---------------|----------------|
| GPS location | Real-time (at snapshot) | User login or manual refresh | High — driver moves |
| Weather | ~5 min (Google API cache) | Per snapshot | Low |
| Traffic | ~5 min (TomTom) | Per briefing generation | Medium — traffic changes fast |
| Events | ~1 hour (Gemini search) | Per briefing generation | Low — events don't change hourly |
| News | ~1 hour | Per briefing generation | Low |
| Strategy | Valid for snapshot duration (60 min TTL) | New snapshot | Medium — conditions change |
| Venue hours | Cached (places_cache) | 7-day refresh | Low — hours rarely change |

---

## 8. Team Size Requirements by Phase

| Phase | Timeline | Team | Focus |
|-------|----------|------|-------|
| **Current** | Now | 1 developer + 2 AI assistants | Core features, documentation |
| **MVP Launch** | 0-3 months | 2 developers | CI/CD, auth hardening, load testing |
| **Growth** | 3-6 months | 3-4 developers | Native iOS app, Android, scaling |
| **Scale** | 6-12 months | 5-7 developers | Multi-region, enterprise features, marketing |
| **Enterprise** | 12+ months | 8-12 developers | Fleet management, partner APIs, compliance |

---

## 9. Current State

| Area | Status |
|------|--------|
| Web app (React) | Working — production deployed |
| Single-server architecture | Working — suitable for <10 concurrent users |
| LLM pipeline (3 providers) | Working — with cross-provider fallback |
| Database (single PostgreSQL) | Working — 25 connection pool |
| PWA | NOT configured (no manifest, no service worker) |
| Native mobile | NOT started |
| Offline mode | Minimal (sessionStorage resume only) |

---

## 10. Known Gaps

1. **No capacity planning metrics** — Don't know current user concurrency or resource utilization.
2. **No load testing baseline** — No k6/Artillery scripts, no performance SLA.
3. **PWA not configured** — No manifest.json, no service worker.
4. **Background execution impossible** — Browser suspends tabs, killing SSE.
5. **Replit vendor lock-in** — Infrastructure tied to Replit platform.

---

## 11. TODO — Hardening Work

- [ ] **Load test with k6** — Establish baseline: requests/sec, P95 latency, breaking point
- [ ] **Configure PWA** — manifest.json + service worker for basic offline + A2HS
- [ ] **Plan native shell** — Swift WebView + background SSE bridge (minimum viable)
- [ ] **Capacity dashboard** — Track concurrent users, DB pool usage, LLM queue depth
- [ ] **Multi-platform hosting evaluation** — Compare Replit vs Railway vs Render vs AWS for scaling needs

---

## Key Files

| File | Purpose |
|------|---------|
| `server/db/connection-manager.js` | DB pool config (25 max) |
| `server/lib/ai/router/concurrency-gate.js` | LLM concurrency limits |
| `server/bootstrap/workers.js` | Worker management + autoscale |
| `gateway-server.js` | Server config + autoscale detection |
| `server/middleware/rate-limit.js` | All rate limiters |
