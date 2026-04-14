# TESTING.md — Comprehensive Testing Documentation

> **Canonical reference** for test pyramid, test catalog, load testing, CI/CD pipeline, mocking strategies, and coverage targets.
> Last updated: 2026-04-14

## Supersedes
- `docs/architecture/TEST_STRATEGY.md` — Previous testing overview (absorbed and expanded into definitive doc)

## Testing Reality Check

| Area | Implemented | Runnable | CI-Enforced | Coverage-Enforced |
|------|-------------|----------|-------------|-------------------|
| Unit (backend) | Yes — 10 files | `npm run test:unit` | No | No |
| Unit (frontend) | Yes — 6 files | `npm run test:client` | No | No |
| Integration | Yes — 4 files | Manual via node | No | No |
| E2E | Yes — Playwright | `npm run test:e2e` | No | No |
| Load | No | — | — | — |
| Smoke | Yes — script | `node tests/scripts/smoke-test.js` | No | — |
| Preflight | Yes — script | `node tests/scripts/preflight-check.js` | No | — |
| Coverage (backend) | collectCoverageFrom configured | `npx jest --coverage` | No | No threshold enforced |
| Coverage (frontend) | collectCoverageFrom configured | `npx jest -c jest.client.config.js --coverage` | No | No threshold enforced |

---

## Table of Contents

1. [Test Pyramid](#1-test-pyramid)
2. [Current Test Inventory](#2-current-test-inventory)
3. [Test Case Catalog by Feature](#3-test-case-catalog-by-feature)
4. [LLM Response Mocking Strategy](#4-llm-response-mocking-strategy)
5. [Load Testing Plan](#5-load-testing-plan)
6. [CI/CD Pipeline with Test Gates](#6-cicd-pipeline-with-test-gates)
7. [Coverage Targets](#7-coverage-targets)
8. [Smoke Tests for Deployment](#8-smoke-tests-for-deployment)
9. [Current State](#9-current-state)
10. [Validation Coverage](#10-validation-coverage)
11. [Critical Test Gaps](#11-critical-test-gaps)
12. [Known Gaps](#12-known-gaps)
13. [TODO — Hardening Work](#13-todo--hardening-work)

---

## 1. Test Pyramid

```
              /\
             /  \          E2E (5%) — Full user journeys, Playwright
            /    \         Target: 5-10 critical paths
           /------\
          /        \       Integration (25%) — API routes, DB, SSE, auth flows
         /          \      Target: 50-80 test cases
        /------------\
       /              \    Unit (70%) — Functions, utilities, validators, transformers
      /                \   Target: 200-300 test cases
     /==================\
```

### Frameworks

| Layer | Framework | Config |
|-------|-----------|--------|
| Unit (backend) | Jest | `jest.config.js` — Node env, 10s timeout |
| Unit (frontend) | Jest + ts-jest | `jest.client.config.js` — jsdom env |
| Integration | Jest | Same backend config |
| E2E | Playwright | `playwright.config.ts`, `npm run test:e2e` |
| Load | k6 (planned) | Not configured |

---

## 2. Current Test Inventory

### Backend Tests (10 files)

| File | Tests | Covers |
|------|-------|--------|
| `tests/schema-validation.test.js` | DB schema contracts | Schema field types/constraints |
| `tests/auth-token-validation.test.js` | Token verification | HMAC-SHA256 sign/verify |
| `tests/blocksApi.test.js` | Blocks API contract | Response shape validation |
| `tests/auth/uber-oauth.test.js` | Uber OAuth | Token exchange flow |
| `tests/coach-schema.test.js` | Coach schema metadata | Schema field exposure |
| `tests/coach-validation.test.js` | Coach Zod schemas | All 11 action tag types |
| `tests/events/pipeline.test.js` | Event pipeline | Discovery + deactivation |
| `tests/bot-blocker.test.js` | Bot detection | UA filtering, blocking |
| `tests/escape-html.test.js` | XSS prevention | HTML escaping utility |
| `tests/translation-prompt.test.js` | Translation | Prompt + JSON parsing |

### Frontend Tests (6 files)

| File | Tests | Covers |
|------|-------|--------|
| `tests/BriefingEventsFetch.test.tsx` | Event fetching | Briefing API integration |
| `tests/BriefingPageEvents.test.tsx` | Event display | Component rendering |
| `tests/BriefingTabIntegration.test.tsx` | Tab integration | Tab switching + data loading |
| `tests/useChatPersistence.test.tsx` | Chat persistence | localStorage sync |
| `tests/SmartBlockEvents.test.tsx` | SmartBlocks events | Event handling |
| `tests/snapshot-ownership-event.test.ts` | Snapshot ownership | Ownership error handling |

### E2E / Integration (5 files)

| File | Tests | Covers |
|------|-------|--------|
| `tests/e2e/copilot.spec.ts` | E2E flow | Co-Pilot journey |
| `tests/gateway/test-routing.js` | API routing | Route mounting |
| `tests/eidolon/test-sdk-integration.js` | SDK integration | Eidolon agent |
| `tests/triad/test-pipeline.js` | Triad pipeline | Strategy→blocks flow |

### Test Runners

- `tests/run-all-tests.js` — Run all tests
- `tests/run-all-phases.js` — Run by phase
- `tests/scripts/smoke-test.js` — Quick health check
- `tests/scripts/preflight-check.js` — Pre-deploy validation

---

## 3. Test Case Catalog by Feature

### Auth (HIGH PRIORITY — mostly untested)

| Test Case | Type | Status |
|-----------|------|--------|
| Login with valid credentials | Integration | NOT TESTED |
| Login with wrong password | Integration | NOT TESTED |
| Account lockout after 5 failures | Integration | NOT TESTED |
| Session TTL expiry (60 min sliding) | Integration | NOT TESTED |
| Session hard limit (2 hr) | Integration | NOT TESTED |
| Logout cleanup (7-step cascade) | Integration | NOT TESTED |
| **Zombie snapshot prevention** | Integration | **NOT TESTED (regression risk)** |
| Google OAuth flow | Integration | NOT TESTED |
| Token verification | Unit | Tested |

### Strategy (Medium priority)

| Test Case | Type | Status |
|-----------|------|--------|
| Briefing→strategy dependency | Integration | NOT TESTED |
| Strategy data optimization functions | Unit | NOT TESTED |
| NOW vs 12HR output format | Unit | NOT TESTED |
| Pipeline phase transitions | Integration | Partial (triad test) |

### Venues (Medium priority)

| Test Case | Type | Status |
|-----------|------|--------|
| Venue scoring (A/B/C grading) | Unit | NOT TESTED |
| Haiku classification (P/S/X) | Unit | NOT TESTED |
| Distance filtering (<25 mi) | Unit | NOT TESTED |
| Event time relevance check | Unit | NOT TESTED |
| `toApiBlock` transformer | Unit | NOT TESTED |

### Offers (Medium priority)

| Test Case | Type | Status |
|-----------|------|--------|
| OCR text pre-parsing | Unit | NOT TESTED |
| Tier classification | Unit | NOT TESTED |
| Phase 1 decision rules | Unit | NOT TESTED |
| Voice formatting | Unit | NOT TESTED |

### SSE (HIGH PRIORITY — untested)

| Test Case | Type | Status |
|-----------|------|--------|
| SSE connection lifecycle | Integration | NOT TESTED |
| closeAllSSE on logout | Integration | NOT TESTED |
| Heartbeat detection | Integration | NOT TESTED |

### Briefing (Partial coverage)

| Test Case | Type | Status |
|-----------|------|--------|
| Backoff retry progression | Unit | NOT TESTED |
| Placeholder detection functions | Unit | NOT TESTED |
| SSE briefing_ready handler | Integration | NOT TESTED |
| Event fetching | Integration | Tested |

---

## 4. LLM Response Mocking Strategy

### Approach: Fixture-Based Mocking

```javascript
// Mock callModel at the adapter level
jest.mock('../../server/lib/ai/adapters/index.js', () => ({
  callModel: jest.fn(async (role, params) => {
    const fixtures = {
      'STRATEGY_TACTICAL': { ok: true, output: '**GO:** ...\n**AVOID:** ...' },
      'VENUE_SCORER': { ok: true, output: JSON.stringify({ recommended_venues: [...] }) },
      'VENUE_FILTER': { ok: true, output: '{"1":"P","2":"S","3":"X"}' },
    };
    return fixtures[role] || { ok: false, output: '', error: 'Unknown role' };
  }),
  callModelStream: jest.fn(),
}));
```

### Fixture Files

Store LLM response fixtures in `tests/fixtures/llm/`:
- `strategy-tactical-response.json`
- `venue-scorer-response.json`
- `briefing-events-response.json`
- `coach-response.json`

### When NOT to Mock

- **Event validation** (`validateEventsHard`) — test with real-world event data (edge cases matter)
- **JSON parsing** (`parseTranslationResponse`) — test with malformed LLM output
- **Offer pre-parser** (`parseOfferText`) — test with real screenshot OCR text

---

## 5. Load Testing Plan

### Tool: k6

### Target Scenarios

| Scenario | VUs | Duration | Target RPS | SLA |
|----------|-----|----------|-----------|-----|
| **Baseline** | 5 | 2 min | 10 | P95 < 2s |
| **Normal load** | 20 | 5 min | 50 | P95 < 5s |
| **Peak load** | 50 | 5 min | 100 | P95 < 10s |
| **Stress test** | 100 | 10 min | 200 | Find breaking point |

### Endpoints to Test

| Endpoint | Weight | Notes |
|----------|--------|-------|
| `GET /api/location/resolve` | 30% | Most frequent |
| `POST /api/blocks-fast` | 20% | Heaviest (LLM calls) — use mocked LLM |
| `GET /api/blocks-fast?snapshotId=` | 20% | Polling |
| `GET /api/briefing/*` | 15% | 6 briefing queries |
| `POST /api/chat` | 10% | Coach streaming |
| `GET /events/*` | 5% | SSE connections |

---

## 6. CI/CD Pipeline with Test Gates

### Proposed Pipeline

```
Push to branch
  ├─ Lint (eslint)
  ├─ Type check (tsc --noEmit)
  ├─ Unit tests (jest, --coverage)
  │   └─ Gate: coverage > 60%
  ├─ Integration tests (jest, backend)
  │   └─ Gate: all pass
  ├─ Build (vite build)
  │   └─ Gate: no build errors
  └─ (On merge to main)
      ├─ Smoke test (health + auth + snapshot)
      └─ Deploy to production
```

### Gate Criteria

| Gate | Threshold | Block Deploy? |
|------|-----------|---------------|
| Unit test pass rate | 100% | Yes |
| Integration test pass rate | 100% | Yes |
| Code coverage | >60% (lines) | Yes |
| Build success | Required | Yes |
| Smoke test | Required | Yes |
| Load test | P95 < SLA | Warning only |

---

## 7. Coverage Targets

### Phase 1 (30 days): 40% Coverage

Focus: auth, transformers, validators, utilities

### Phase 2 (60 days): 60% Coverage

Add: API route integration tests, SSE lifecycle, briefing queries

### Phase 3 (90 days): 75% Coverage

Add: E2E journeys, load testing, coach integration

### Exclusions from Coverage

- `client/src/components/ui/*.tsx` (Shadcn — third-party)
- `server/eidolon/` (separate system)
- Generated files, config files

---

## 8. Smoke Tests for Deployment

### Quick Smoke (30 seconds)

```javascript
// tests/scripts/smoke-test.js
1. GET /health → 200 OK
2. GET /ready → READY
3. POST /api/auth/login (test credentials) → 200 + token
4. GET /api/auth/me (with token) → 200 + profile
5. GET /api/location/resolve?lat=33.12&lng=-96.87 → 200 + city
```

### Full Smoke (2 minutes)

```javascript
6. POST /api/blocks-fast → 202 or 200
7. GET /api/briefing/weather/:snapshotId → 200
8. GET /events/strategy → SSE connection opens
9. POST /api/translate → 200 + translated text
10. GET /api/intelligence/markets-dropdown → 200 + markets
```

---

## 9. Current State

| Area | Status |
|------|--------|
| Test files | 21 total (10 backend, 6 frontend, 5 integration) |
| Framework | Jest + ts-jest |
| CI/CD | NOT configured |
| Coverage reporting | Configured (manual run, no CI enforcement) |
| Load testing | NOT configured |
| LLM mocking | NOT standardized |
| Smoke tests | Script exists (manual) |

---

## 10. Validation Coverage

The validation system is well-designed but enforcement proof is partial.

| Layer | What Exists | Proven By Tests | Enforcement Status |
|-------|-------------|-----------------|-------------------|
| **Request schemas** | `server/validation/schemas.js` — Zod schemas for API inputs | `tests/coach-validation.test.js` (11 action types) | Route-by-route — not centrally enforced |
| **Response schemas** | `server/validation/response-schemas.js` — SmartBlockSchema, etc. | `tests/blocksApi.test.js` (shape validation) | Used in `toApiBlock()` transformer |
| **Transformers** | `server/validation/transformers.js` — `toApiBlock()`, `toApiVenue()` | Implicitly via blocks API tests | All block responses route through transformers |
| **Schema contracts** | `tests/schema-validation.test.js` — DB schema field verification | Direct test | Schema-level only, not runtime |

**What is NOT proven:** Broad automated response-schema enforcement across all routes. Individual routes may return raw data without passing through `validateResponse()` or transformers. A comprehensive route-by-route enforcement audit has not been performed.

---

## 11. Critical Test Gaps

Prioritized list of missing tests that should be written. See §12 Known Gaps for broader context.

### P0 — Blocks Deployment Confidence

| Gap | What To Test | Suggested File |
|-----|-------------|----------------|
| Auth login/logout/session TTL | Full auth flow including JWT issuance, session expiry, zombie fix | `tests/auth/auth-flow.test.js` |
| `toApiBlock()` transformer contract | Input→output shape with all field variants (open/closed, event/no-event, staging) | `tests/validation/toApiBlock.test.js` |

### P1 — Blocks Feature Confidence

| Gap | What To Test | Suggested File |
|-----|-------------|----------------|
| SSE lifecycle | Connect, receive events, auth-drop behavior, reconnect | `tests/sse/strategy-events.test.js` |
| `isEventTimeRelevant()` | 24h, 12h, edge cases (midnight, noon, malformed) | `tests/venue/event-time.test.js` |
| Strategy NOW vs 12HR format | Immediate vs daily strategy output shape validation | `tests/strategy/format.test.js` |

### P2 — Improves Quality

| Gap | What To Test | Suggested File |
|-----|-------------|----------------|
| Offer tier classification | `classifyTier()` for all known product types | `tests/offers/classify-tier.test.js` |
| Voice formatting | Translation prompt + TTS voice selection | `tests/translate/voice.test.js` |
| Zombie snapshot prevention | Staleness detection + reset behavior in blocks-fast | `tests/strategy/staleness.test.js` |

---

## 12. Known Gaps

1. **No CI/CD pipeline** — Tests run manually only.
2. **No load testing** — Unknown breaking point.
3. **No LLM mock standard** — Each test mocks differently.
4. **No coverage enforcement** — Collection configured but no minimum threshold.

> Auth, SSE, and zombie-snapshot gaps are now tracked with priorities in §11 Critical Test Gaps.

---

## 13. TODO — Hardening Work

- [ ] **Set up CI/CD** — GitHub Actions with test gates on every push (P0)
- [ ] **Auth integration tests** — Login, logout, TTL, zombie regression (P0)
- [ ] **Coverage reporting** — Istanbul/c8 with 60% threshold (P1)
- [ ] **LLM fixture mocks** — Standard fixtures in tests/fixtures/llm/ (P1)
- [ ] **k6 load testing scripts** — Baseline + peak + stress scenarios (P1)
- [ ] **SSE test harness** — EventSource mock for connection lifecycle (P2)
- [x] **E2E with Playwright** — configured (`playwright.config.ts`, `tests/e2e/copilot.spec.ts`). Expand to 5-10 journeys (P2)
- [ ] **Automated smoke tests** — Run on every deploy (P1)

---

## Key Files

| File | Purpose |
|------|---------|
| `jest.config.js` | Backend test config |
| `jest.client.config.js` | Frontend test config |
| `tests/` | All 21 test files |
| `tests/run-all-tests.js` | Test runner |
| `tests/scripts/smoke-test.js` | Deployment smoke test |
| `tests/scripts/preflight-check.js` | Pre-deploy validation |
