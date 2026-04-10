# NIST.md — NIST Cybersecurity Framework Compliance Mapping

> **Canonical reference** mapping Vecto Pilot's security posture against the NIST Cybersecurity Framework (CSF) categories.
> Last updated: 2026-04-10

---

## Table of Contents

1. [IDENTIFY (ID)](#1-identify-id)
2. [PROTECT (PR)](#2-protect-pr)
3. [DETECT (DE)](#3-detect-de)
4. [RESPOND (RS)](#4-respond-rs)
5. [RECOVER (RC)](#5-recover-rc)
6. [Summary Matrix](#6-summary-matrix)
7. [Gap Remediation Plan](#7-gap-remediation-plan)

---

## 1. IDENTIFY (ID)

### ID.AM — Asset Management

| Control | Status | Current Implementation | Gap |
|---------|--------|----------------------|-----|
| **ID.AM-1** Physical devices inventoried | N/A | SaaS application, no physical assets | — |
| **ID.AM-2** Software platforms inventoried | Partial | `package.json` lists dependencies; no formal SBOM | Generate SBOM (CycloneDX) |
| **ID.AM-3** Data flows mapped | Implemented | AUTH.md, SNAPSHOT.md, BRIEFING.md document all data flows | — |
| **ID.AM-4** External systems catalogued | Implemented | LLM-REQUESTS.md documents all 12 external APIs + keys | — |
| **ID.AM-5** Resources prioritized | Partial | No formal data classification. PII fields identified in DB_SCHEMA.md | Add data classification labels |
| **ID.AM-6** Cybersecurity roles established | Not Implemented | Solo developer (Melody). No formal security roles | Define security responsibilities |

### ID.BE — Business Environment

| Control | Status | Implementation |
|---------|--------|----------------|
| **ID.BE-1** Organization's role in supply chain | N/A | End-user SaaS, not a supply chain participant |
| **ID.BE-3** Priorities established | Implemented | FUTURE.md prioritizes P0 (security), P1 (user impact), P2 (quality) |

### ID.RA — Risk Assessment

| Control | Status | Implementation | Gap |
|---------|--------|----------------|-----|
| **ID.RA-1** Vulnerabilities identified | Implemented | SECURITY.md documents 10 known gaps | — |
| **ID.RA-2** Threat intelligence received | Not Implemented | No threat feed integration | Subscribe to CVE alerts for dependencies |
| **ID.RA-3** Threats identified | Partial | Zero-auth endpoint, brute force, IDOR flagged | No formal threat model |
| **ID.RA-5** Risk responses identified | Implemented | SECURITY.md TODO section prioritizes remediation | — |

---

## 2. PROTECT (PR)

### PR.AC — Access Control

| Control | Status | Implementation | Gap | Ref |
|---------|--------|----------------|-----|-----|
| **PR.AC-1** Identities managed | Implemented | `driver_profiles.user_id` (UUID), email unique constraint | — | AUTH.md §1 |
| **PR.AC-3** Remote access managed | Implemented | CORS whitelist, Replit/production domains only | No-origin requests allowed | AUTH.md §3 |
| **PR.AC-4** Access permissions managed | Implemented | `requireAuth` middleware, `requireSnapshotOwnership` | Not all routes covered | SECURITY.md §8 |
| **PR.AC-5** Network integrity protected | Partial | HTTPS enforced in prod, HSTS 1yr | No WAF, `unsafe-inline` in CSP | SECURITY.md §9 |
| **PR.AC-7** Users authenticated | Implemented | HMAC-SHA256 token, session TTL (60min/2hr), bcrypt passwords | Non-standard token format | AUTH.md §2 |

### PR.AT — Awareness and Training

| Control | Status | Gap |
|---------|--------|-----|
| **PR.AT-1** Users informed and trained | Not Applicable | Driver app, not enterprise. No security training needed for end users |

### PR.DS — Data Security

| Control | Status | Implementation | Gap | Ref |
|---------|--------|----------------|-----|-----|
| **PR.DS-1** Data-at-rest protected | Partial | Uber tokens: AES-256-GCM. Passwords: bcrypt 12 rounds. DB: Replit-managed | No full database encryption | AUTH.md §2 |
| **PR.DS-2** Data-in-transit protected | Implemented | HTTPS/TLS in production, HSTS enforced | Dev uses HTTP | SECURITY.md §10 |
| **PR.DS-5** Protections against data leaks | Partial | PII removed from concierge (H-2 fix). IDOR fixed (F-6) | GPS data in snapshots not encrypted | SECURITY.md §11 |
| **PR.DS-6** Integrity checking | Implemented | HMAC-SHA256 token integrity, `crypto.timingSafeEqual` for agent auth | — | AUTH.md §2 |

### PR.IP — Information Protection

| Control | Status | Implementation | Gap |
|---------|--------|----------------|-----|
| **PR.IP-1** Security baseline maintained | Implemented | Helmet, CSP, CORS, rate limiting | `unsafe-inline` in CSP |
| **PR.IP-3** Configuration change control | Partial | Git version control, code review | No formal change management |
| **PR.IP-9** Response/recovery plans tested | Not Implemented | disaster-recovery.md exists but untested | Schedule DR drills |
| **PR.IP-12** Vulnerability management plan | Partial | SECURITY.md documents known gaps + priorities | No automated scanning |

### PR.MA — Maintenance

| Control | Status | Gap |
|---------|--------|-----|
| **PR.MA-1** Maintenance performed | Partial | Dependencies updated ad-hoc. No scheduled patching cycle |

### PR.PT — Protective Technology

| Control | Status | Implementation | Ref |
|---------|--------|----------------|-----|
| **PR.PT-1** Audit/log records | Partial | Console logging, no persistent audit table | SECURITY.md §13 |
| **PR.PT-3** Least functionality | Partial | Bot blocker, rate limiting | Unauthenticated endpoints exist |
| **PR.PT-4** Communication networks protected | Implemented | CORS whitelist, TLS | — |

---

## 3. DETECT (DE)

### DE.AE — Anomalies and Events

| Control | Status | Implementation | Gap |
|---------|--------|----------------|-----|
| **DE.AE-1** Baseline of operations established | Not Implemented | No normal traffic baseline | Define baseline metrics |
| **DE.AE-2** Events analyzed | Not Implemented | No event correlation | Add SIEM or log aggregation |
| **DE.AE-3** Event data aggregated | Not Implemented | Logs are console-only, not aggregated | Centralize logging (ELK/Datadog) |
| **DE.AE-5** Incident alert thresholds | Not Implemented | No alerting on auth failures or rate limit spikes | Add alerting rules |

### DE.CM — Continuous Monitoring

| Control | Status | Implementation | Gap |
|---------|--------|----------------|-----|
| **DE.CM-1** Network monitored | Not Implemented | No network monitoring | — |
| **DE.CM-4** Malicious code detected | Partial | Bot blocker blocks known bots | No malware scanning |
| **DE.CM-7** Unauthorized personnel/devices monitored | Not Implemented | No device fingerprinting or unusual login detection | Add login anomaly detection |
| **DE.CM-8** Vulnerability scans | Not Implemented | No automated vulnerability scanning | Add `npm audit` in CI |

### DE.DP — Detection Processes

| Control | Status | Gap |
|---------|--------|-----|
| **DE.DP-1** Roles for detection defined | Not Implemented | No SOC, no monitoring roles |
| **DE.DP-4** Event detection communicated | Partial | Auth errors dispatch `vecto-auth-error` event | No external alerting |

---

## 4. RESPOND (RS)

### RS.RP — Response Planning

| Control | Status | Implementation | Ref |
|---------|--------|----------------|-----|
| **RS.RP-1** Response plan executed | Partial | `SECURITY.md` vulnerability reporting. Account lockout auto-triggers | No formal IRP |

### RS.CO — Communications

| Control | Status | Implementation |
|---------|--------|----------------|
| **RS.CO-2** Events reported | Implemented | `security@vectopilot.com` contact, 48hr acknowledgment |
| **RS.CO-3** Information shared | Partial | Coordinated disclosure policy in SECURITY.md |

### RS.AN — Analysis

| Control | Status | Implementation | Gap |
|---------|--------|----------------|-----|
| **RS.AN-1** Notifications investigated | Partial | Auth errors logged to console | No persistent investigation log |
| **RS.AN-3** Forensics performed | Not Implemented | No forensic capability | `auth_credentials.last_login_ip` provides minimal trail |

### RS.MI — Mitigation

| Control | Status | Implementation | Ref |
|---------|--------|----------------|-----|
| **RS.MI-1** Incidents contained | Implemented | Account lockout (5 failures → 15min lock), session kill on 401 | AUTH.md §4 |
| **RS.MI-2** Incidents mitigated | Implemented | 10 security fixes applied (F-1 through H-3) | SECURITY.md §11 |

### RS.IM — Improvements

| Control | Status | Implementation |
|---------|--------|----------------|
| **RS.IM-1** Response plans incorporate lessons | Implemented | LESSONS_LEARNED.md captures production mistakes |

---

## 5. RECOVER (RC)

### RC.RP — Recovery Planning

| Control | Status | Implementation | Ref |
|---------|--------|----------------|-----|
| **RC.RP-1** Recovery plan executed | Documented | `docs/architecture/disaster-recovery.md` — deployment rollback, DB restore, API fallback | Not tested |

### RC.IM — Improvements

| Control | Status | Implementation |
|---------|--------|----------------|
| **RC.IM-1** Recovery plans incorporate lessons | Implemented | LESSONS_LEARNED.md updated after each incident |

### RC.CO — Communications

| Control | Status | Gap |
|---------|--------|-----|
| **RC.CO-3** Recovery activities communicated | Not Implemented | No status page or user notification during outages |

---

## 6. Summary Matrix

| NIST Function | Controls Assessed | Implemented | Partial | Not Implemented |
|---------------|-------------------|-------------|---------|-----------------|
| **IDENTIFY** | 11 | 4 | 4 | 3 |
| **PROTECT** | 16 | 9 | 5 | 2 |
| **DETECT** | 9 | 0 | 3 | 6 |
| **RESPOND** | 7 | 4 | 2 | 1 |
| **RECOVER** | 3 | 2 | 0 | 1 |
| **TOTAL** | **46** | **19 (41%)** | **14 (30%)** | **13 (28%)** |

**Strongest:** PROTECT (access control, encryption, input validation)
**Weakest:** DETECT (no monitoring, no SIEM, no alerting)

---

## 7. Gap Remediation Plan

### Phase 1: Immediate (0–30 days)

| Priority | Control | Action | Effort |
|----------|---------|--------|--------|
| P0 | PR.AC-4 | Add auth to `/api/hooks/analyze-offer` | 2 days |
| P0 | PR.PT-1 | Create `audit_log` table, log auth events | 3 days |
| P0 | DE.CM-8 | Add `npm audit` to CI pipeline | 1 day |
| P1 | PR.AC-7 | Add dedicated auth rate limiter (10/min/IP) | 1 day |

### Phase 2: Short-term (30–60 days)

| Priority | Control | Action | Effort |
|----------|---------|--------|--------|
| P1 | DE.AE-3 | Centralize logging (structured JSON → Datadog/ELK) | 5 days |
| P1 | DE.AE-5 | Add alerting: failed logins >10/min, rate limits hit | 2 days |
| P1 | PR.DS-1 | Evaluate database encryption options | 2 days |
| P2 | ID.AM-2 | Generate SBOM with CycloneDX | 1 day |
| P2 | PR.AC-7 | Migrate to standard JWT (RFC 7519) | 5 days |

### Phase 3: Medium-term (60–180 days)

| Priority | Control | Action | Effort |
|----------|---------|--------|--------|
| P2 | DE.CM-7 | Login anomaly detection (unusual IP/location) | 5 days |
| P2 | PR.IP-12 | Automated dependency vulnerability scanning | 3 days |
| P3 | DE.AE-1 | Establish operational baseline metrics | 3 days |
| P3 | RC.CO-3 | Status page for outage communication | 2 days |
| P3 | RS.AN-3 | Forensic logging (immutable audit trail) | 5 days |

---

## References

- SECURITY.md — Current security posture and known gaps
- AUTH.md — Authentication flow, token lifecycle, session management
- DB_SCHEMA.md — Data schema with PII inventory
- `docs/architecture/disaster-recovery.md` — Recovery procedures
- `SECURITY.md` (root) — Vulnerability reporting policy
- `LESSONS_LEARNED.md` — Production incident learnings
