# TEST_STRATEGY.md — Testing Strategy and Coverage

> **Canonical reference** for current test coverage, recommended test pyramid, and CI/CD test pipeline plans.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Current Test Files](#1-current-test-files)
2. [Test Frameworks](#2-test-frameworks)
3. [What's Tested vs Untested](#3-whats-tested-vs-untested)
4. [Recommended Test Pyramid](#4-recommended-test-pyramid)
5. [Current State](#5-current-state)
6. [Known Gaps](#6-known-gaps)
7. [TODO — Hardening Work](#7-todo--hardening-work)

---

## 1. Current Test Files

### Backend Tests (10 files)

| File | What It Tests |
|------|---------------|
| `tests/schema-validation.test.js` | DB schema contract validation |
| `tests/auth-token-validation.test.js` | JWT/HMAC token verification |
| `tests/blocksApi.test.js` | Blocks API response contract |
| `tests/auth/uber-oauth.test.js` | Uber OAuth flow |
| `tests/coach-schema.test.js` | AI Coach schema metadata |
| `tests/coach-validation.test.js` | Coach action Zod validation |
| `tests/events/pipeline.test.js` | Event sync pipeline |
| `tests/bot-blocker.test.js` | Bot/traffic detection |
| `tests/escape-html.test.js` | XSS prevention (escapeHtml) |
| `tests/translation-prompt.test.js` | Translation feature |

### Frontend Tests (6 files)

| File | What It Tests |
|------|---------------|
| `tests/BriefingEventsFetch.test.tsx` | Briefing events fetching |
| `tests/BriefingPageEvents.test.tsx` | Briefing page event display |
| `tests/BriefingTabIntegration.test.tsx` | Briefing tab integration |
| `tests/useChatPersistence.test.tsx` | Chat state persistence |
| `tests/SmartBlockEvents.test.tsx` | Smart blocks event handling |
| `tests/snapshot-ownership-event.test.ts` | Snapshot ownership |

### E2E/Integration (5 files)

| File | What It Tests |
|------|---------------|
| `tests/e2e/copilot.spec.ts` | Co-Pilot E2E flow |
| `tests/integration/` | Integration tests |
| `tests/gateway/test-routing.js` | API routing |
| `tests/eidolon/test-sdk-integration.js` | Eidolon SDK |
| `tests/triad/test-pipeline.js` | Triad computation pipeline |

### Test Runners

- `tests/run-all-tests.js` — Run all
- `tests/run-all-phases.js` — Run by phase
- `tests/scripts/smoke-test.js` — Quick smoke test
- `tests/scripts/preflight-check.js` — Pre-deploy check

---

## 2. Test Frameworks

- **Jest** — Node environment (10s timeout)
- **ts-jest** — TypeScript transpilation
- **jsdom** — Browser simulation for React tests
- **Config:** `jest.config.js` (backend), `jest.client.config.js` (frontend)

---

## 3. What's Tested vs Untested

### Tested

- Schema contracts and validation
- Auth token verification and Uber OAuth
- Coach action Zod schemas
- Event pipeline (discovery, deactivation)
- Briefing integration (events fetch, display, tab)
- Chat persistence
- SmartBlocks event handling
- Bot detection
- XSS prevention (HTML escaping)
- Translation feature
- API routing
- Eidolon SDK integration

### NOT Tested (Critical Gaps)

| Area | Risk | Priority |
|------|------|----------|
| **Auth login/logout flow** | Auth bugs = locked out users | HIGH |
| **Zombie snapshot fix** | Regression = data leak | HIGH |
| **SSE connections** | Silent failures = stale UI | HIGH |
| **LLM response parsing** | Bad JSON = broken pipeline | HIGH |
| **Concierge public endpoints** | Security gap = abuse | MEDIUM |
| **Strategy generation** | Bad advice = driver frustration | MEDIUM |
| **Rate limiting** | Missing limits = abuse | MEDIUM |
| **Error boundaries** | Crash recovery | LOW |
| **Full E2E journey** (login → strategy → feedback) | User flow broken | HIGH |
| **Performance/load** | Slow under concurrent users | MEDIUM |
| **DB migrations** | Schema upgrade failures | LOW |
| **Concurrent requests** | Race conditions | MEDIUM |

---

## 4. Recommended Test Pyramid

```
         /\
        /  \        E2E (5%)
       /    \       Full user journeys (Playwright)
      /------\
     /        \     Integration (25%)
    /          \    API routes, DB queries, SSE, auth flows
   /------------\
  /              \  Unit (70%)
 /                \ Functions, utilities, validators, transformers
/==================\
```

### Unit Tests (Priority Additions)

- `consolidator.js` prompt optimization functions
- `transformers.js` toApiBlock/toApiVenue
- `co-pilot-helpers.ts` SSE Manager
- `location-context-clean.tsx` auth-drop effect
- Event validation (validateEventsHard)
- Hours calculation (parseGoogleWeekdayText)

### Integration Tests (Priority Additions)

- Auth login → token → protected route
- Snapshot creation → strategy generation → blocks
- SSE connection → event propagation → query invalidation
- Logout → cleanup → re-login (zombie regression)

### E2E Tests (Priority Additions)

- Login → GPS → snapshot → strategy → bars → briefing → logout
- Google OAuth flow (when fully wired)
- Concierge: scan QR → explore → ask → feedback

---

## 5. Current State

| Area | Status |
|------|--------|
| Test files | 21 total (10 backend, 6 frontend, 5 e2e/integration) |
| Framework | Jest + ts-jest |
| CI/CD pipeline | Not configured (no GitHub Actions/Replit CI) |
| Coverage reporting | Not configured |
| Automated test runs | Manual only |

---

## 6. Known Gaps

1. **No CI/CD test pipeline** — Tests are run manually, not on push/PR.
2. **No coverage reporting** — No metrics on what percentage of code is tested.
3. **No LLM mock framework** — No standard way to mock LLM calls in tests.
4. **No SSE test infrastructure** — No way to test real-time events end-to-end.
5. **No load testing** — No performance baseline for concurrent users.

---

## 7. TODO — Hardening Work

- [ ] **Set up CI/CD** — Run tests on every push (GitHub Actions or Replit CI)
- [ ] **Add coverage reporting** — Istanbul/c8 with 60% minimum threshold
- [ ] **LLM mock framework** — Standardized mocks for callModel/callModelStream
- [ ] **SSE test harness** — EventSource mock for testing real-time flows
- [ ] **Auth integration tests** — Login, logout, token expiry, zombie fix regression
- [ ] **Load testing** — k6 or Artillery scripts for concurrent user simulation
- [ ] **Snapshot tests** — React component snapshots for UI regression
- [ ] **Contract tests** — API response schema validation (Zod or JSON Schema)

---

## Key Files

| File | Purpose |
|------|---------|
| `jest.config.js` | Backend test config |
| `jest.client.config.js` | Frontend test config |
| `tests/` | All test files (21 files) |
| `tests/run-all-tests.js` | Test runner |
