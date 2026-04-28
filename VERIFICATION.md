# VERIFICATION.md — audit-fix-2026-04-25

> Per-item verification results for the 13-fix audit run.
> Session key: `audit-fix-2026-04-25`. All progress also recorded in the
> `claude_memory` DB table (mapped to existing schema: `session_id`,
> `category`=phase, `metadata`=notes).

## Summary

| Tier | Items   | Status                                              |
|------|---------|-----------------------------------------------------|
| P0   | 1, 2, 3 | All done — verified live against running gateway    |
| P1   | 4, 5, 6 | All done — verified via grep + curl                 |
| P2   | 7, 8, 9, 10 | All done — verified via grep                    |
| P3   | 11, 12, 13 | 11 + 12 done; 13 trigger not met (see below)     |

## Detail

| #  | Fix                                       | Status   | Verify cmd                                                                                  | Verify output                                                                                                                            |
|----|-------------------------------------------|----------|---------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | helmet/cors before health + static (P0-1) | DONE     | `curl -sI -A "<UA>" http://localhost:5000/api/health` → `curl -sI .../` → `curl -sI .../assets/<bundle>.js` | All three return `Content-Security-Policy: ...`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff` |
| 2  | `/api/diagnostic/db-info` deleted (P0-2)  | DONE     | `curl -s -o /dev/null -w "%{http_code}" -A "<UA>" http://localhost:5000/api/diagnostic/db-info` | `HTTP 404` (was 200 with `database_host` JSON leak)                                                                                      |
| 3  | JWKS handler + key-rotation note (P0-3)   | DONE     | `curl -s -A "<UA>" http://localhost:5000/.well-known/jwks.json` + content-type header check | Returns the JWKS object (RSA, kid `vectopilot-rs256-k1`, alg RS256, use sig); `Content-Type: application/json; charset=utf-8`. CHANGELOG.md notes operator must rotate `keys/private.pem`. |
| 4  | Uber callback navigate path (P1-4)        | DONE     | `grep -n "navigate('/settings')" client/src/pages/auth/uber/Callback.tsx` (expect empty)    | Empty. New `navigate('/co-pilot/settings')` present at lines 35 and 77.                                                                  |
| 5  | Apple button disabled (P1-5)              | DONE     | `grep -n "Apple — Coming soon" client/src/pages/auth/SignInPage.tsx client/src/pages/auth/SignUpPage.tsx` | Both files show muted disabled button with `aria-disabled="true"`, title "Sign In/Up with Apple is coming soon", no onClick prop.        |
| 6  | job-metrics relative router paths (P1-6)  | DONE     | `curl /api/job-metrics` → 200, `curl /api/job-metrics/abc-123` → 404 (`job_not_found`), old `/api/job-metrics/api/metrics/jobs` → 404 | Old concatenated path now 404 (was 200); documented `/api/job-metrics` works (was 404).                                                  |
| 7  | `/api/users/me` route removed (P2-7)      | DONE     | `grep -n "router.get('/users/me'" server/api/location/location.js` (expect empty)           | Empty. Block `USER` removed from `client/src/constants/apiRoutes.ts`. Comment cleaned in `server/api/location/index.js`. Zero source refs to `/api/users/me` remain. |
| 8  | Uber years/makes/models removed (P2-8)    | DONE     | `grep -rE "platform/uber/(years\|makes\|models)" client/src server/`                        | Empty. `PLATFORM.UBER.{YEARS,MAKES,MODELS}` block removed from `apiRoutes.ts`. The unrelated `VEHICLE.{YEARS,MAKES,MODELS}` block is preserved (it has live callers at `SettingsPage.tsx:271` and `SignUpPage.tsx:285`). |
| 9  | strategy `/history` before `/:snapshotId` (P2-9) | DONE | `grep -n "router.get" server/api/strategy/strategy.js`                                       | `/history` now at line 30, `/:snapshotId` at line 73 (history declared first; param route no longer shadows it).                         |
| 10 | Delete `public/privacy-policy.html` (P2-10) | DONE   | `ls public/privacy-policy.html`                                                             | `No such file or directory`. React `/policy` route confirmed at `client/src/routes.tsx:51` → `PolicyPage.tsx`.                            |
| 11 | DB row counts (P3-11)                     | DONE     | `SELECT count(*) FROM <each of 15 tables>` via `psql $DATABASE_URL`                         | Written to `AUDIT_DB_COUNTS.md`. **Important:** `pg_stat_user_tables.n_live_tup` was stale (returned 0 for all tables). Used real `COUNT(*)` instead — see `AUDIT_DB_COUNTS.md`. |
| 12 | Seed DFW venues (P3-12)                   | DONE     | `node server/scripts/seed-dfw-venues.js` → recheck `SELECT count(*) FROM venue_metrics`     | Seed script had pre-existing bug (`venue_catalog.name` vs schema `venue_name`); fixed in same run. Result: `venue_metrics` 0 → 11. `markets` already at 338, so `seed-markets.js` was NOT run. |
| 13 | Catch-block instrumentation (P3-13)       | NOT TRIGGERED | `SELECT count(*)` on `users/snapshots/strategies/briefings/rankings/triad_jobs`         | All six tables have non-zero rows in dev (5 / 231 / 226 / 226 / 449 / 226). Per Melody's directive, instrumentation is conditional on a listed table being `0` "in a DB known to have been used"; condition not met here. **Recommend rechecking against prod (Neon) per Rule 13** before discarding the work. |

## P0 verification — full security header dump

The actual CSP / HSTS / X-Content-Type-Options strings observed on `/`,
`/api/health`, and `/assets/<bundle>.js` after restart:

```
Content-Security-Policy: default-src 'self';script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com;style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;font-src 'self' https://fonts.gstatic.com;img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com https://places.googleapis.com;connect-src 'self' https://maps.googleapis.com https://places.googleapis.com https://routes.googleapis.com https://*.replit.dev https://*.replit.app wss://*.replit.dev wss://*.replit.app;frame-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'self';script-src-attr 'none';upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
```

## P0-3 sub-finding

Implementing P0-3 surfaced a related defect: `server/middleware/bot-blocker.js`
treats `/.well-known/` as a suspicious-path prefix and was returning 404 for
`/.well-known/jwks.json` ahead of the new handler. Fixed by adding an explicit
allow for the literal path `/.well-known/jwks.json`. The broader prefix
remains in the deny list (it still blocks bot probes for
`/.well-known/openid-configuration`, `/.well-known/acme-challenge`, etc.).

## P3-12 sub-finding

`server/scripts/seed-dfw-venues.js` referenced `venue_catalog.name` and
`venue.name` for both the existence check (line 243) and the insert payload
(line 253), but the Drizzle schema column is `venue_name`. The script
generated `WHERE  = $1` (empty column name) and 42601'd. Fixed inline so
the seed could complete. **This is a pre-existing bug in the script — log
follow-up so the next time someone seeds, they don't have to re-fix it.**

## Files changed (16)

### P0
- `gateway-server.js` — middleware ordering, db-info deletion, JWKS handler
- `server/middleware/bot-blocker.js` — JWKS allow-list
- `CHANGELOG.md` — operator key-rotation note

### P1
- `client/src/pages/auth/uber/Callback.tsx` — navigate path
- `client/src/pages/auth/SignInPage.tsx` — Apple button disabled
- `client/src/pages/auth/SignUpPage.tsx` — Apple button disabled
- `server/api/health/job-metrics.js` — relative router paths

### P2
- `server/api/location/location.js` — `/users/me` handler removed
- `server/api/location/index.js` — comment cleanup
- `client/src/constants/apiRoutes.ts` — `USER` block + `PLATFORM.UBER` block removed
- `server/api/strategy/strategy.js` — `/history` reordered before `/:snapshotId`
- `public/privacy-policy.html` — deleted

### P3
- `AUDIT_DB_COUNTS.md` — new (top-level)
- `server/scripts/seed-dfw-venues.js` — column-name bug fix

### Final
- `VERIFICATION.md` — this file

## Persistence (claude_memory rows inserted)

| id  | session_id              | category        | status |
|-----|-------------------------|-----------------|--------|
| 169 | audit-fix-2026-04-25    | P0-security     | done   |
| (n) | audit-fix-2026-04-25    | P1-bugs         | done   |
| (n) | audit-fix-2026-04-25    | P2-dead-code    | done   |
| (n) | audit-fix-2026-04-25    | P3-db-sanity    | done   |
| (n) | audit-fix-2026-04-25    | audit-fix-complete | done |

(Schema in this DB uses `session_id` / `category` / `metadata` instead of
the spec's `session_key` / `phase` / `notes` — mapped at INSERT time to
preserve existing data.)
