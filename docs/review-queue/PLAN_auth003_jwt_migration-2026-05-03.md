# [INTENT_MAPPING] Workstream 1 Phase 3 — Standard JWT Migration (AUTH-003)

> **Status:** Phase 0 — APPROVED 2026-05-03 (Y from Melody). Phase 1 execution authorized with the AUTH-003 label correction (was: ARCH-001).
> **Date:** 2026-05-03
> **Branch:** `feat/auth-003-jwt-migration` (based on `origin/main` @ `bfb0f9d3`)
> **Source roadmap line:** `docs/MASTER_ROADMAP.md:12` — *"Migrate away from the custom HMAC-SHA256 tokens (`userId.signature`) to standard JWTs to unblock third-party integrations."*
> **Authoritative current-state doc:** `docs/architecture/AUTH.md` §2 (Token Lifecycle), §8 (Known Gaps #3), §9 (TODO #3).
> **Label provenance:** Re-labeled from ARCH-001 → AUTH-003 because the work derives from `AUTH.md §9 TODO #3` and ARCH-001 is double-mapped in the docs (also points at session-table-split, which is archived). AUTH-003 has clean provenance.

---

## 0. Doctrine Discrepancy Surfaced During Recon (resolving in this PR)

**Two ARCH-001s exist in the docs**, and they refer to different things:

| Source | ARCH-001 means | Status |
|---|---|---|
| `docs/MASTER_ROADMAP.md:12` | Standard JWT migration (this work, now relabeled AUTH-003) | **Active** |
| `docs/DOC_DISCREPANCIES.md:98` | "Users table used for sessions with `onDelete: 'restrict'`… split into separate `sessions` table" | **Stale row** — same item is in `docs/reviewed-queue/DOC_DISCREPANCIES_ARCHIVE.md:393`, so the active row is a duplicate ghost |

**Resolution in this PR:**
- Replace `DOC_DISCREPANCIES.md` ARCH-001 row with an AUTH-003 tracker row referencing this migration; mark FIXED on PR merge.
- `MASTER_ROADMAP.md:12` updated to reflect the AUTH-003 label and check off on PR merge.
- The session-table-split ARCH-001 is already archived; no further action.

This is a Rule 9 drift item directly in the migration's blast radius. Bundling it.

---

## 1. Objective

Replace the custom HMAC-SHA256 token format `userId.HMAC-SHA256(userId, secret)` with standard JWTs containing claims (`exp`, `iat`, `iss`, `aud`, `sub`), using the `jose` library that is already a dependency. Achieve this **without forcing every active user to re-login** by introducing a brief dual-verify transition window aligned to the existing 2-hour session hard limit.

**Why now:**
1. **Roadmap-stated unblocker** — third-party integrations cannot meaningfully consume `userId.signature` without taking on our exact secret + replicating our verifier. Standard JWTs with documented claims are the universal interop format.
2. **Token-level expiry** — current tokens have no `exp`. A leaked token is valid until the server's session is cleared (up to 2 hours from session start). JWTs with `exp` close that window structurally.
3. **Auditability** — `iat`/`iss`/`aud` enable forensic analysis without chasing logs.
4. **AUTH.md §9 TODO #3** — already documented as required hardening.

**Out of scope (logged as future work):**
- Refresh-token rotation (separate, larger feature: short-lived access + long-lived refresh + revocation list).
- Service-account `x-vecto-agent-secret` migration to JWT (different threat model).
- Asymmetric algorithm (RS256/ES256) — see §2.2 below for staged-Phase-2 plan.

---

## 2. Locked-In Decisions (per Y approval)

| # | Decision | Rationale |
|---|---|---|
| Q1 | **HS256 now, RS256 deferred to Phase 2 PR** | Minimal change vector for ship-now; asymmetric needs keypair-rotation runbook |
| Q2 | **2-hour `exp` (matches session hard limit)** | No refresh endpoint needed in v1; refresh-token feature deferred |
| Q3 | **Dual-verify rollout** | Zero forced logouts; segment-count dispatch self-rolls |
| Q4 | **Replace `server/lib/jwt.ts` as real helper module** | Centralized JWT helpers |
| Q5 | **Audit existing tests first** (DONE — `tests/auth-token-validation.test.js` becomes free legacy-HMAC regression test) | New tests in `tests/auth/` |
| Q6 | **Update `auth-system.md` inline** | Defer doc consolidation to a separate cleanup PR |
| Q7 | **No feature flag** | Dispatch logic is self-rolling |
| Q8 | **Service-account auth out of scope** | Separate threat model |
| Q9 | **Refresh-token mechanism out of scope** | Separate feature |
| Q10 | **DOC_DISCREPANCIES.md ARCH-001 row cleanup IN scope** | Rule 9 blast-radius drift |
| Q11 | **`location.js` inline verifier consolidation IN scope** | Non-negotiable; otherwise that route would reject JWTs |

### 2.1. Library: `jose` v6.1.1 (already installed)

Modern, Node-native, ESM-first, type-safe, supports JWS/JWE/JWT. No new dep added.

### 2.2. Algorithm: HS256 (Phase 1) with RS256 follow-up plan

| Algo | Mechanism | Third-party verification | Phase fit |
|---|---|---|---|
| **HS256** (HMAC-SHA256) | Symmetric — same secret for sign + verify | Third party must hold signing secret | **Phase 1 (this PR)** |
| **RS256/ES256** (asymmetric) | Private key signs, public key verifies | Third parties verify with public key only | **Phase 2 (future PR)** — keypair generation, key rotation runbook, secret-to-keypair migration |

### 2.3. Claims (Phase 1 token shape)

```json
{
  "sub": "<userId UUID>",
  "iat": <unix timestamp>,
  "exp": <iat + 2h>,
  "iss": "vecto-pilot",
  "aud": "vecto-pilot-api"
}
```

No custom claims in v1. Email stays in response body, not in token. Smaller token, less PII at rest in localStorage.

### 2.4. Dual-Verify Rollout

```js
async function verifyAppToken(token) {
  const segments = token.split('.');
  if (segments.length === 3) return verifyJWT(token);          // New format
  if (segments.length === 2) return verifyLegacyHMAC(token);   // Old format
  throw new Error('Invalid token format');
}
```

**Important security note:** JWT verifier failure does **not** fall through to HMAC verifier. Each segment count maps to exactly one verifier. Otherwise an attacker could craft a malformed JWT (3 segments) and downgrade-attack into HMAC by stripping a segment.

### 2.5. Phase 1.5 Cleanup (separate follow-up PR, ~24h post-deploy)

- Delete legacy HMAC verifier branch
- Delete legacy compat tests (or this PR's `tests/auth-token-validation.test.js` if it's still HMAC-only)
- Update AUTH.md to remove "Transition" section

---

## 3. Files Affected (this PR)

### 3.1. Code

| File | Change |
|---|---|
| `server/lib/jwt.ts` | **Replace** 14-line dev stub with real JWT module: `signJWT({ sub })` and `verifyJWT(token)` using `jose`. Exports both. |
| `server/api/auth/auth.js` | Replace `generateAuthToken` body (line 58) with `signJWT({ sub: userId })`. Function signature unchanged → 4 issuance call sites at 504/777/1742/1868 don't need edits. |
| `server/middleware/auth.js` | Replace `verifyAppToken` (lines 71-108) with dual-dispatch by `token.split('.').length`. Keep legacy HMAC body inline for transition. |
| `server/api/location/location.js` | **Delete** inline verifier (lines 451-467). Import + use `verifyAppToken` from middleware/auth.js. |
| `server/config/env-registry.js` | Update inline comment at line 140: `JWT_SECRET` now signs JWTs (was: HMAC tokens). |
| `server/config/validate-env.js` | Update inline comment at lines 36-41 to reflect JWT format. No logic change. |

### 3.2. Tests

| File | Status | Change |
|---|---|---|
| `tests/auth/jwt-helpers.test.js` | NEW | Unit tests for `signJWT` / `verifyJWT` round-trip + claim validation + tampering |
| `tests/auth/dual-verify-dispatch.test.js` | NEW | Unit tests for `verifyAppToken` segment-count dispatch + downgrade-attack prevention |
| `tests/auth-token-validation.test.js` | EXISTING (untouched) | Continues to pass via legacy HMAC verifier branch — acts as free legacy-compat regression test |

### 3.3. Docs (Phase 1 PR)

| File | Change |
|---|---|
| `docs/architecture/AUTH.md` | Update §2 (Token Lifecycle) with new format + claims table; §3 (Middleware Chain) reflects dispatch; §7 (Current State) tokens are now JWT; §8 (Known Gaps) remove #3; §9 (TODO) check off #3 (HS256 done; RS256 noted as Phase 2) |
| `docs/architecture/auth-system.md` | Align to truth — currently misrepresents HMAC as JWT. Update inline (defer full consolidation into AUTH.md to a separate PR per Q6) |
| `docs/DOC_DISCREPANCIES.md` | Replace stale ARCH-001 row with AUTH-003 tracker; mark FIXED on PR merge |
| `docs/MASTER_ROADMAP.md` | Update Workstream 1 line to AUTH-003 label; add `[x]` + completion date on PR merge |
| `LESSONS_LEARNED.md` | New "AUTH-003 dual-verify migration" lesson — segment-count dispatch pattern + the `location.js` inline-verifier discovery |
| `claude_memory` table | New row (engineering-pattern) capturing the dual-verify pattern + segment-count dispatch |

---

## 4. Migration / Rollout Strategy

| Phase | Time | Action |
|---|---|---|
| Pre-deploy | T-N | PR review + merge |
| Pre-deploy | T-1h | Verify staging deploy: new logins issue 3-segment JWTs |
| Deploy | T+0 | Deploy Phase 1 to prod. New logins issue JWTs; existing sessions continue with HMAC tokens. |
| Soak | T+0 → T+2h | Sessions hit their 2-hour hard limit, force re-login → users get JWTs |
| Soak | T+0 → T+24h | matrixLog `[AUTH] [LEGACY_HMAC_USED]` count drops to 0 |
| Cleanup | T+24h | Open Phase 1.5 PR — delete legacy verifier branch |

### Rollback plan

Single-commit revert restores HMAC issuance + verification. Tokens issued during the bad deploy will fail verification under HMAC and force re-login (~30-60 min of in-flight users). Acceptable.

---

## 5. Required Test Cases

### 5.1. `tests/auth/jwt-helpers.test.js` — `signJWT` / `verifyJWT`

| # | Case | Expected |
|---|---|---|
| 1 | Sign + verify round-trip with valid claims | `{ userId, verified: true }` |
| 2 | Verify with tampered signature | Throws `Invalid signature` |
| 3 | Verify with tampered payload | Throws `Invalid signature` |
| 4 | Verify with `exp` in the past | Throws (jose: `exp must be > now`) |
| 5 | Verify with wrong `iss` | Throws (jose: `unexpected "iss" claim value`) |
| 6 | Verify with wrong `aud` | Throws (jose: `unexpected "aud" claim value`) |
| 7 | Verify with malformed token (4 segments) | Throws |
| 8 | Verify with missing `sub` | Throws |
| 9 | Sign with empty userId | Throws (input validation) |

### 5.2. `tests/auth/dual-verify-dispatch.test.js` — segment-count routing

| # | Case | Expected |
|---|---|---|
| 10 | Token with 3 dot-segments routes to JWT verifier | JWT path called |
| 11 | Token with 1 dot-segment (legacy `userId.sig`) routes to HMAC verifier | HMAC path called |
| 12 | Token with 0 segments | Throws `Invalid token format` |
| 13 | Token with 2 dot-segments (raw `header.payload`, no sig) | Throws `Invalid token format` |
| 14 | Token with 4+ segments | Throws `Invalid token format` |
| 15 | JWT verifier failure does NOT fall through to HMAC verifier (security: prevents downgrade) | Throws JWT-specific error, HMAC not called |
| 16 | HMAC verifier failure does NOT fall through to JWT (parallel concern) | Throws HMAC-specific error |

### 5.3. Free regression — existing `tests/auth-token-validation.test.js`

Continues to pass under the legacy HMAC verifier branch. No edits needed. If this test fails after migration, the legacy branch is broken — block PR.

---

## 6. Stop Gate (Phase 1 → Phase 2 transition)

Phase 2 (PR review) requires:
- All tests green (jest + existing auth-token-validation regression + new auth/* tests)
- `npm run lint` clean
- `npm run typecheck` clean
- AUTH.md and auth-system.md aligned with implementation (read by Master Architect to confirm doc-truth match)
- DOC_DISCREPANCIES ARCH-001 row replaced
- claude_memory row inserted

---

*Phase 0 approved 2026-05-03 by Melody. Phase 1 execution in progress on `feat/auth-003-jwt-migration`.*
