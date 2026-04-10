# ISO.md — ISO 27001 Annex A Compliance Mapping

> **Canonical reference** mapping Vecto Pilot's security controls against ISO 27001:2022 Annex A controls.
> Last updated: 2026-04-10

---

## Table of Contents

1. [A.5 — Organizational Controls](#a5--organizational-controls)
2. [A.6 — People Controls](#a6--people-controls)
3. [A.7 — Physical Controls](#a7--physical-controls)
4. [A.8 — Technological Controls](#a8--technological-controls)
5. [Summary Matrix](#summary-matrix)
6. [Gap Remediation Plan](#gap-remediation-plan)

---

## A.5 — Organizational Controls

### A.5.1 Policies for Information Security

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.5.1** Information security policies | Partial | `SECURITY.md` (root) defines vulnerability reporting. `CLAUDE.md` defines dev process rules. No formal ISMS policy document | Create formal information security policy |
| **A.5.2** Information security roles | Not Implemented | Solo developer. No CISO, no security team | Define security responsibilities |
| **A.5.3** Segregation of duties | Not Implemented | Single developer has full access to all systems | Implement role-based access for future team |

### A.5.7 Threat Intelligence

| Control | Status | Gap |
|---------|--------|-----|
| **A.5.7** Threat intelligence | Not Implemented | No threat feed, no CVE monitoring for dependencies | Subscribe to GitHub Dependabot/Advisory alerts |

### A.5.8 Information Security in Project Management

| Control | Status | Evidence |
|---------|--------|----------|
| **A.5.8** Security in project management | Partial | CLAUDE.md Rule 9: "All findings are HIGH priority." Security fixes tracked in DOC_DISCREPANCIES.md |

### A.5.23–A.5.30 Supplier Relationships

| Control | Status | Evidence |
|---------|--------|----------|
| **A.5.23** Information security for cloud services | Partial | Replit manages infrastructure. `database-environments.md` documents dev vs prod separation. No formal cloud security assessment |
| **A.5.29** Information security during disruption | Partial | `disaster-recovery.md` documents recovery procedures for deployment, DB, and API outages |

---

## A.6 — People Controls

### A.6.1–A.6.8

| Control | Status | Evidence |
|---------|--------|----------|
| **A.6.1** Screening | N/A | Solo developer, no employees to screen |
| **A.6.2** Terms of employment | N/A | Solo developer |
| **A.6.3** Information security awareness | N/A | Solo developer (Melody). Awareness demonstrated via LESSONS_LEARNED.md |
| **A.6.5** Responsibilities after termination | N/A | Solo developer |

---

## A.7 — Physical Controls

### A.7.1–A.7.14

| Control | Status | Evidence |
|---------|--------|----------|
| **A.7.1–A.7.14** Physical security | N/A | Cloud SaaS on Replit. No physical infrastructure owned. Replit manages physical data center security |

---

## A.8 — Technological Controls

### A.8.1 User Endpoint Devices

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.1** User endpoint devices | Partial | Driver devices are BYOD (personal phones). Wake Lock prevents screen sleep during translation. No MDM or endpoint management |

### A.8.2–A.8.5 Access Control

| Control | Status | Evidence | Gap | Ref |
|---------|--------|----------|-----|-----|
| **A.8.2** Privileged access rights | Partial | `requireAuth` on all protected routes. Service account via `x-vecto-agent-secret` with constant-time comparison | Eidolon agent has full DB access with no row-level scoping | AUTH.md §3 |
| **A.8.3** Information access restriction | Implemented | `requireSnapshotOwnership` middleware. IDOR fix F-6 uses `req.auth.userId` | Not applied to all snapshot-consuming routes | SECURITY.md §8 |
| **A.8.4** Source code access | Implemented | Private GitHub repository. Git-based version control | — |
| **A.8.5** Secure authentication | Partial | bcrypt 12 rounds, session TTL (60min sliding + 2hr hard), account lockout (5 failures → 15min) | Non-standard token format (no JWT exp/iat). No MFA | AUTH.md §2,4 |

### A.8.6 Capacity Management

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.6** Capacity management | Partial | DB connection pool: 25 max, 80% warning threshold. TomTom: 2,500 req/day free tier. No formal capacity planning |

### A.8.7–A.8.8 Malware & Vulnerability

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.7** Protection against malware | Partial | Bot blocker middleware blocks known bots | No runtime malware scanning |
| **A.8.8** Technical vulnerability management | Partial | 10 security fixes applied (F-1 through H-3). SECURITY.md tracks gaps | No automated vulnerability scanning (`npm audit` not in CI) |

### A.8.9 Configuration Management

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.9** Configuration management | Implemented | `CLAUDE.md` defines 14 mandatory rules. Env vars via Replit Secrets. Drizzle config + schema versioned in Git |

### A.8.10 Information Deletion

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.10** Information deletion | Partial | Coach notes: soft delete (`is_active = false`). Auth: session cleared on logout (`session_id = null`) | Snapshots retained indefinitely. No PII deletion workflow. No GDPR right-to-erasure | DB_SCHEMA.md §15 |

### A.8.11–A.8.12 Data Masking & Prevention of Data Leakage

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.11** Data masking | Partial | Phone removed from public concierge (H-2 fix). Auth tokens not logged | GPS coordinates stored in plain text in snapshots |
| **A.8.12** Data leakage prevention | Partial | CORS whitelist. CSP headers. `.gitignore` for .env files. GitHub push protection blocked leaked API key | No DLP solution |

### A.8.13–A.8.14 Backup & Redundancy

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.13** Information backup | Partial | Replit daily automated backups. `pg_dump` manual command documented | No verified restore testing. No off-site backup |
| **A.8.14** Redundancy | Not Implemented | Single DB instance, no read replicas, single server | Add read replica for analytics |

### A.8.15–A.8.16 Logging & Monitoring

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.15** Logging | Partial | Console logging via `createLogger()`. Auth events logged. Health endpoints monitored | No persistent audit log table. No centralized logging (ELK/Datadog) |
| **A.8.16** Monitoring activities | Partial | `unified-ai-capabilities.js` monitors AI system health. Health endpoints at `/health`, `/api/health` | No anomaly detection. No failed-login alerting |

### A.8.20 Network Security

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.20** Network security | Partial | HTTPS/TLS in production. HSTS 1yr. CORS whitelist. Rate limiting (100/min global). Bot blocker |
| **Gap** | | No WAF. No network segmentation. No API gateway |

### A.8.21 Security of Network Services

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.21** Network services security | Partial | Replit manages infrastructure TLS. No explicit SLA with API providers |

### A.8.24 Use of Cryptography

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.24** Cryptography use | Partial | **Passwords:** bcrypt 12 rounds. **Uber tokens:** AES-256-GCM at rest. **Auth tokens:** HMAC-SHA256. **TLS:** Managed by Replit | No DB encryption at rest. No key rotation mechanism. Non-standard token format |

### A.8.25 Secure Development Lifecycle

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.25** Secure development | Implemented | CLAUDE.md enforces: planning before implementation, code review, test requirements. Drizzle ORM prevents SQL injection. Zod validates all input. React auto-escapes XSS |

### A.8.26 Application Security Requirements

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.26** Application security requirements | Partial | Input validation (Zod). SQL injection prevention (Drizzle). XSS prevention (CSP + React). Rate limiting | Zero-auth endpoint (`/api/hooks/analyze-offer`). No per-user rate limiting |

### A.8.28 Secure Coding

| Control | Status | Evidence |
|---------|--------|----------|
| **A.8.28** Secure coding | Implemented | Parameterized queries (Drizzle). No `eval()`. No `dangerouslySetInnerHTML`. `escapeHtml()` utility. `sanitizeString()` on inputs |

### A.8.31 Separation of Development, Test, and Production

| Control | Status | Evidence | Ref |
|---------|--------|----------|-----|
| **A.8.31** Environment separation | Implemented | Dev and Prod are separate Replit Helium PostgreSQL instances. `DATABASE_URL` auto-injected per environment. SSL required for prod only | `database-environments.md` |

### A.8.33 Test Information

| Control | Status | Evidence | Gap |
|---------|--------|----------|-----|
| **A.8.33** Test information | Partial | 21 test files exist. Jest + ts-jest. Manual test runs | No CI/CD pipeline. No coverage reporting. No production data in tests |

---

## Summary Matrix

| Annex A Group | Controls Assessed | Implemented | Partial | Not Implemented | N/A |
|---------------|-------------------|-------------|---------|-----------------|-----|
| **A.5 Organizational** | 8 | 0 | 4 | 3 | 1 |
| **A.6 People** | 4 | 0 | 0 | 0 | 4 |
| **A.7 Physical** | 1 | 0 | 0 | 0 | 1 |
| **A.8 Technological** | 22 | 7 | 12 | 3 | 0 |
| **TOTAL** | **35** | **7 (20%)** | **16 (46%)** | **6 (17%)** | **6 (17%)** |

### Compliance Rating by Category

| Category | Rating | Notes |
|----------|--------|-------|
| **Access Control** | Strong | requireAuth, session TTL, IDOR fixes, snapshot ownership |
| **Cryptography** | Good | bcrypt, AES-256-GCM, HMAC-SHA256, TLS |
| **Secure Development** | Strong | ORM, validation, escaping, env separation |
| **Logging & Monitoring** | Weak | Console only, no SIEM, no alerting |
| **Incident Management** | Partial | Lockout + vulnerability reporting, no formal IRP |
| **Business Continuity** | Partial | DR documented but untested |
| **Data Protection** | Partial | Some encryption, no full DB encryption, no data retention |

---

## Gap Remediation Plan

### Priority 1: Compliance Blockers (0–30 days)

| Control | Action | Effort |
|---------|--------|--------|
| A.8.26 | Add authentication to `/api/hooks/analyze-offer` | 2 days |
| A.8.15 | Create `audit_log` table for auth events | 3 days |
| A.8.8 | Add `npm audit` to CI/CD | 1 day |
| A.5.1 | Draft formal Information Security Policy | 2 days |

### Priority 2: Significant Gaps (30–90 days)

| Control | Action | Effort |
|---------|--------|--------|
| A.8.15 | Centralized logging (JSON structured → aggregation) | 5 days |
| A.8.16 | Add alerting rules (failed logins, rate limits) | 2 days |
| A.8.5 | Migrate to standard JWT (RFC 7519) with exp/iat | 5 days |
| A.8.10 | Implement data retention policy (90-day snapshots) | 3 days |
| A.8.10 | Add PII deletion workflow (GDPR right-to-erasure) | 3 days |
| A.8.24 | Implement API key rotation mechanism | 3 days |
| A.8.33 | Set up CI/CD with automated test runs | 3 days |

### Priority 3: Improvements (90–180 days)

| Control | Action | Effort |
|---------|--------|--------|
| A.5.7 | Subscribe to CVE/threat intelligence feeds | 1 day |
| A.8.14 | Add read replica for redundancy | 3 days |
| A.8.13 | Verified backup restore testing (quarterly) | 1 day |
| A.8.20 | Evaluate WAF (Cloudflare/AWS WAF) | 2 days |
| A.8.16 | Login anomaly detection (unusual locations) | 5 days |

---

## References

- **SECURITY.md** (docs/architecture/) — Current security posture, 10 known gaps, recent fixes
- **AUTH.md** (docs/architecture/) — Authentication flow, token format, session management
- **DB_SCHEMA.md** (docs/architecture/) — Data schema, PII fields, connection pooling
- **NIST.md** (docs/architecture/) — NIST CSF mapping (complementary framework)
- **disaster-recovery.md** (docs/architecture/) — Recovery procedures
- **database-environments.md** (docs/architecture/) — Dev vs Prod environment separation
- **LESSONS_LEARNED.md** — Production incident learnings
- **SECURITY.md** (root) — Vulnerability reporting policy
