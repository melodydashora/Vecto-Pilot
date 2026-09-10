# VP-002 / VP-006 client candidate

Provenance: Astra Replit, at Melody's relayed authorization, September 10, 2026.
Branch: `codex/vp-auth-query-20260910`.
Base: `3674a4407147813a4c47a4ecce85f04779d9bd9b` (Claude leaf fixes and operator guards).
This is an isolated candidate; no deployment or live database writes.

Google callback now completes through the mounted AuthProvider, as password login does.
Existing Google users enter protected routes without reloading. New users retain the
existing token-before-terms ordering but publish authenticated React state only after
successful terms acceptance. A failed terms save retains the checkbox and retry action.
StrictMode effect replay shares one exchange request. Both account-conflict responses
are non-retrying errors; password revocation stays visible until the driver continues.

AuthProvider and manual GPS refresh now clear the QueryClient supplied by App.
Login, logout, auth errors and invalid profile responses cancel queries and clear that
cache. Local logout completes before its server request; the response cannot clear a
subsequent client's login. Profile and password-login responses from an obsolete auth
transition cannot restore the old identity. This does not change server session semantics.

Both QueryClient instances and their different defaults remain intact. OffersCard,
QUERY_KEYS, App, server auth, shared harness, Briefing, Coach and FAA are unchanged.
URL-state binding, server-side terms enforcement, query-key redesign and full isolation
of non-query module/React state remain separate work. Do not describe this candidate
as closing all of VP-006 or the complete release-readiness umbrella (todo 75).

Validation (candidate source):

- `npm run lint`: passed, zero warnings.
- `npm run typecheck`: passed (`tsc -b`).
- `npm run test:client -- --runInBand --testPathIgnorePatterns=/node_modules/ --runTestsByPath tests/client/auth-completion.test.tsx`: 13 passed. Uses the real AuthProvider, route guard, QueryClient and callback; synthetic fetch only.
- `NODE_ENV=production npm run build -- --outDir /tmp/vp-auth-query-build`: passed; existing large-chunk warning remains.
- `/tmp/vp-auth-browser.mjs`: 16 production Chromium scenarios passed: existing Google login, failed/retried terms, both 409 contracts and revocation notice at 320/390/1440 px; A logout → B login → B offers in one page lifetime. No horizontal overflow in these checks. 320 px revocation screenshot visually inspected.

Browser checks use a disposable local static server, intercept every API request,
block external requests/service workers, and replace GPS/SSE with inert fixtures.
No real account credentials, user-session interaction, OAuth provider request or gateway
startup. These results do not claim real Google integration or the full client suite
passes. Claude's previously reported Briefing test debt remains separate.

Local evidence: `/tmp/vp-auth-jest.log`, `/tmp/vp-auth-typecheck.log`,
`/tmp/vp-auth-build.log`, `/tmp/vp-auth-browser-results.json`.
