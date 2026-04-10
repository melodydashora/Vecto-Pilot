# RISKS.md — Risk Register and Mitigation Plan

> **Canonical reference** for technical, business, operational, and security risks with severity matrix and mitigation strategies.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Risk Severity Matrix](#1-risk-severity-matrix)
2. [Technical Risks](#2-technical-risks)
3. [Security Risks](#3-security-risks)
4. [Operational Risks](#4-operational-risks)
5. [Business Risks](#5-business-risks)
6. [Mitigation Priority](#6-mitigation-priority)

---

## 1. Risk Severity Matrix

| | **Low Impact** | **Medium Impact** | **High Impact** | **Critical Impact** |
|---|---|---|---|---|
| **Very Likely** | Low | Medium | High | Critical |
| **Likely** | Low | Medium | High | High |
| **Possible** | Low | Low | Medium | High |
| **Unlikely** | Low | Low | Low | Medium |

---

## 2. Technical Risks

### T-1: Single Database Instance (CRITICAL)

| Property | Value |
|----------|-------|
| **Likelihood** | Possible |
| **Impact** | Critical — total app outage, data loss |
| **Severity** | HIGH |
| **Current state** | Single Replit Helium PostgreSQL 16 instance. No replication. |
| **Mitigation** | Daily Replit backups (automated). Manual pg_dump documented. |
| **Remediation** | Add read replica. Implement automated backup verification. Define RTO/RPO. |
| **Owner** | Infrastructure |

### T-2: Gemini Vendor Lock-in (HIGH)

| Property | Value |
|----------|-------|
| **Likelihood** | Likely |
| **Impact** | High — 18+ roles use Gemini as primary. Coach, briefing, events, concierge all Gemini-dependent. |
| **Severity** | HIGH |
| **Current state** | HedgedRouter provides cross-provider fallback for 9 roles. Coach streaming is Gemini-only (no fallback). |
| **Mitigation** | Adapter pattern allows model swap via config. Claude and OpenAI adapters exist. |
| **Remediation** | Add streaming support to all adapters. Ensure Coach can fall back to Claude streaming. |
| **Owner** | AI Engineering |

### T-3: SSE Connection Limits (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Possible (at scale) |
| **Impact** | Medium — users see stale data, polling fallback works for briefing but not strategy/blocks |
| **Severity** | MEDIUM |
| **Current state** | No hard limit. Depends on Node.js memory + OS file descriptors. No client auto-reconnect. |
| **Mitigation** | 30s heartbeat detects dead connections. Singleton client pattern reduces connections. |
| **Remediation** | Add client auto-reconnect with backoff. Consider Redis pub/sub for horizontal scaling. |
| **Owner** | Backend |

### T-4: LLM Rate Limits and Quotas (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Likely (at scale) |
| **Impact** | Medium — degraded service, strategy generation delays |
| **Severity** | MEDIUM |
| **Current state** | No proactive quota monitoring. TomTom: 2,500/day free tier. Rate limits detected reactively (429). |
| **Mitigation** | HedgedRouter circuit breaker (5 failures → 60s cooldown). Concurrency gate (10/provider). |
| **Remediation** | Add quota monitoring dashboard. Pre-computed cost alerts. Provider auto-scaling. |
| **Owner** | AI Engineering |

### T-5: No CI/CD Pipeline (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Very Likely |
| **Impact** | Medium — regressions ship to production |
| **Severity** | MEDIUM |
| **Current state** | 21 test files exist but run manually only. No automated test gates. |
| **Mitigation** | Smoke test script available. Preflight checks documented. |
| **Remediation** | Set up GitHub Actions or Replit CI with test gates on every push. |
| **Owner** | DevOps |

---

## 3. Security Risks

### S-1: Zero-Auth Offer Analysis Endpoint (CRITICAL)

| Property | Value |
|----------|-------|
| **Likelihood** | Possible |
| **Impact** | Critical — any client can submit images for AI analysis, burn LLM budget |
| **Severity** | HIGH |
| **Current state** | `POST /api/hooks/analyze-offer` has no authentication. Rate limiting by device_id (spoofable). |
| **Mitigation** | URL obscurity. IP-based rate limiting. |
| **Remediation** | Add device registration. Require one-time API key provisioning. |
| **Owner** | Security |
| **Ref** | SECURITY.md §8, NIST.md PR.AC-4, ISO.md A.8.26 |

### S-2: Non-Standard Token Format (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Unlikely |
| **Impact** | High — no token expiry in payload, no rotation, no blacklist |
| **Severity** | MEDIUM |
| **Current state** | Custom `userId.hmacSignature`. No `exp`, `iat`, `iss`, `aud` claims. |
| **Mitigation** | Session TTL enforced server-side (60min sliding + 2hr hard). |
| **Remediation** | Migrate to RFC 7519 JWT with short-lived access + refresh tokens. |
| **Owner** | Security |

### S-3: No Audit Log (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Very Likely (for compliance) |
| **Impact** | Medium — can't investigate security incidents, NIST/ISO non-compliant |
| **Severity** | MEDIUM |
| **Current state** | Auth events logged to console only. No persistent audit table. |
| **Remediation** | Create `audit_log` table. Log all auth events. |
| **Owner** | Security |
| **Ref** | LOGGING.md §7, NIST.md DE.AE-3, ISO.md A.8.15 |

---

## 4. Operational Risks

### O-1: Key Person Dependency (HIGH)

| Property | Value |
|----------|-------|
| **Likelihood** | Very Likely |
| **Impact** | High — single developer (Melody) is sole knowledge holder |
| **Severity** | HIGH |
| **Current state** | Architecture docs (26 docs, 8,325+ lines) mitigate knowledge loss. CLAUDE.md provides process rules. |
| **Mitigation** | This documentation suite. coach-inbox.md for AI-to-human knowledge transfer. |
| **Remediation** | Onboard second developer. Cross-train on critical systems (auth, strategy, AI adapters). |
| **Owner** | Management |

### O-2: LLM Cost Overruns (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Likely (at scale) |
| **Impact** | Medium — 7+ Gemini calls per briefing session, Claude for strategy, GPT for venues |
| **Severity** | MEDIUM |
| **Current state** | No per-user cost tracking. No budget alerts. Token counts stored but not converted to cost. |
| **Estimated costs** | ~$0.05–0.15 per user session (briefing + strategy + venues). Coach chat: ~$0.01–0.05 per message. |
| **Remediation** | Add cost tracking dashboard. Set per-user daily budgets. Cache repeated queries. |
| **Owner** | Engineering |

### O-3: Scaling Bottlenecks (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Possible (at >100 concurrent users) |
| **Impact** | Medium — degraded performance, timeout errors |
| **Severity** | MEDIUM |
| **Current state** | 25 DB connections (8-11 per active user). Single Node.js process. No Redis caching layer. |
| **Mitigation** | Advisory locks prevent duplicate work. Autoscale mode disables workers on multi-instance. |
| **Remediation** | Add Redis for caching + rate limiting. Implement queue-based LLM processing. Add read replica. |
| **Owner** | Infrastructure |

---

## 5. Business Risks

### B-1: Market Timing — FIFA World Cup 2026 (HIGH)

| Property | Value |
|----------|-------|
| **Likelihood** | Very Likely |
| **Impact** | High — translation feature + DFW market focus built for this event |
| **Severity** | HIGH |
| **Current state** | Translation supports 20 languages. DFW-specific offer analysis. Market intelligence for major US cities. |
| **Mitigation** | Core features working. Translation tested. |
| **Remediation** | Complete mobile app (native wrapper) before World Cup. Load test for concurrent users. |
| **Owner** | Product |

### B-2: Platform Dependency (Uber/Lyft APIs) (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Possible |
| **Impact** | Medium — no direct Uber/Lyft API for surge data. Offer analysis via screenshots only. |
| **Severity** | MEDIUM |
| **Current state** | Screenshot-based offer analysis (Siri Shortcuts). No official partner API access. |
| **Mitigation** | Platform-agnostic design. Offer analysis works from screenshot OCR. |
| **Remediation** | Seek official API partnerships. Integrate PredictHQ for event demand data. |
| **Owner** | Business Development |

### B-3: No Revenue Model Implemented (MEDIUM)

| Property | Value |
|----------|-------|
| **Likelihood** | Very Likely |
| **Impact** | Medium — running costs without revenue |
| **Severity** | MEDIUM |
| **Current state** | No pricing tiers, no payment integration, no subscription management. |
| **Remediation** | Define pricing tiers. Integrate Stripe. Implement usage-based billing for LLM calls. |
| **Owner** | Product |

---

## 6. Mitigation Priority

### Immediate (P0, 0–30 days)

1. **S-1:** Add auth to offer analysis endpoint
2. **S-3:** Create audit_log table
3. **T-5:** Set up CI/CD with test gates

### Short-term (P1, 30–60 days)

4. **O-2:** Add LLM cost tracking dashboard
5. **T-4:** Add quota monitoring + alerts
6. **S-2:** Migrate to standard JWT

### Medium-term (P2, 60–180 days)

7. **T-1:** Add database read replica
8. **T-2:** Add streaming to all adapters (eliminate Gemini lock-in for Coach)
9. **O-3:** Add Redis caching layer
10. **O-1:** Onboard second developer

---

## Key References

| Doc | Relevant Risks |
|-----|---------------|
| SECURITY.md | S-1, S-2, S-3, all security risks |
| NIST.md | S-3 (DE.AE-3), S-1 (PR.AC-4) |
| ISO.md | S-3 (A.8.15), S-1 (A.8.26) |
| SCALABILITY.md | T-1, T-3, O-3 |
| LLM-REQUESTS.md | T-2, T-4, O-2 |
| AI_MODEL_ADAPTERS.md | T-2 (Gemini lock-in) |
