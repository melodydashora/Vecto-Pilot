# CONVERSION.md — Platform Conversion and Migration Planning

> **Canonical reference** for React web to native migration paths, shared API layer, feature flags, and conversion timeline.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Conversion Options Evaluated](#1-conversion-options-evaluated)
2. [Recommended Path: Native Shell → Hybrid → Full Native](#2-recommended-path)
3. [Shared API Layer](#3-shared-api-layer)
4. [Feature Flag System](#4-feature-flag-system)
5. [Data Migration Between Platforms](#5-data-migration-between-platforms)
6. [Beta Testing Strategy](#6-beta-testing-strategy)
7. [Conversion Timeline](#7-conversion-timeline)
8. [Team Skill Requirements](#8-team-skill-requirements)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Conversion Options Evaluated

| Option | Pros | Cons | Effort | Recommendation |
|--------|------|------|--------|---------------|
| **React Native** | Code sharing with web, one codebase | Performance overhead, limited native API access, dependency hell | Medium | **Not recommended** — limited native bridge support for SSE, Speech API |
| **Swift + Kotlin (Full native)** | Best performance, full platform APIs, App Store approved | Two codebases, high effort, no web sharing | Very High | Ultimate target, not Phase 1 |
| **WebView Shell + Native Bridges** | Fast, reuses existing web app, solves background execution | Limited native feel, WebView performance | Low | **Phase 1 — Recommended starting point** |
| **Capacitor/Ionic** | Web → native wrapper, plugin ecosystem | Performance ceiling, dependency on Capacitor team | Medium | Viable alternative to raw WebView |
| **Flutter** | Cross-platform, single codebase, native performance | Full rewrite, Dart learning curve, no React code reuse | Very High | Not recommended for existing React codebase |

---

## 2. Recommended Path

### Phase 1: Native Shell (2-4 weeks per platform)

Wrap existing React web app in native container with bridges:

**iOS (Swift):**
```
SwiftUI App
  └─ WKWebView (loads vectopilot.com)
       └─ Native bridges:
            ├─ BackgroundSSEService (URLSession, always-on)
            ├─ PushNotificationHandler (APNs)
            ├─ BackgroundLocationManager (CLLocationManager)
            ├─ BiometricAuthBridge (LocalAuthentication)
            └─ SiriKit IntentHandler (native offer analysis)
```

**Android (Kotlin):**
```
Compose Activity
  └─ AndroidWebView (loads vectopilot.com)
       └─ Native bridges:
            ├─ BackgroundSSEService (Foreground Service + OkHttp)
            ├─ PushNotificationHandler (FCM)
            ├─ BackgroundLocationManager (Fused Location)
            ├─ BiometricAuthBridge (BiometricPrompt)
            └─ ShareIntentReceiver (offer screenshots)
```

### Phase 2: Hybrid (1-3 months)

Replace performance-critical screens with native UI:
1. **Map** — Google Maps SDK (native) replaces Google Maps JS
2. **Strategy card** — Native SSE consumer with real-time updates
3. **Offer analysis** — Full SiriKit / Share Intent integration

### Phase 3: Full Native (3-6 months)

Complete migration: all screens native, web app becomes maintenance-only fallback.

---

## 3. Shared API Layer

### API Contract

The server API is already client-agnostic. Native apps use the **exact same REST endpoints** as the web app.

**No API changes needed for Phase 1.**

### Key Contracts

| Domain | Endpoints | Auth |
|--------|-----------|------|
| Auth | POST /api/auth/login, POST /api/auth/google/exchange | Returns Bearer token |
| Location | GET /api/location/resolve | Bearer token |
| Pipeline | POST /api/blocks-fast, GET /api/blocks-fast | Bearer token |
| Coach | POST /api/chat (SSE streaming) | Bearer token |
| Briefing | GET /api/briefing/* (6 endpoints) | Bearer token |
| SSE | GET /events/* (4 endpoints) | Stateless |
| Offers | POST /api/hooks/analyze-offer | device_id (no JWT) |
| Translation | POST /api/translate | Bearer token |
| TTS | POST /api/tts | Bearer token |

### API Versioning (Future)

Currently: no versioning (all endpoints at `/api/*`).
Recommended for multi-platform: prefix with version `/api/v1/*` when native clients ship. This allows breaking changes to web without breaking native (and vice versa).

---

## 4. Feature Flag System

### Current

**File:** `docs/architecture/feature-management.md` (42 lines)

Environment variables only:
- `ENABLE_BACKGROUND_WORKER` (default: false)
- `USE_LISTEN_MODE` (default: false)
- `LOG_LEVEL` (default: info)

### Recommended for Multi-Platform

```javascript
// Feature flag service
const flags = {
  'native-push-notifications': { web: false, ios: true, android: true },
  'native-map': { web: false, ios: 'phase2', android: 'phase2' },
  'offer-analysis-v2': { web: false, ios: true, android: false },
};
```

**Options:** LaunchDarkly, GrowthBook (open-source), or simple DB-backed flags.

### Gradual Rollout

1. Ship native app to 10% of users (beta track)
2. Monitor crash rates, LLM costs, session duration
3. Increase to 50% → 100% over 2 weeks
4. Roll back if P95 latency or crash rate exceeds threshold

---

## 5. Data Migration Between Platforms

### User Account Migration

**No migration needed.** Same API, same database. User logs in on native app with same email/password or Google OAuth. All data (profile, notes, history) is server-side.

### Client-Side Data

| Data | Web Storage | Native Storage | Migration |
|------|------------|---------------|-----------|
| Auth token | localStorage | Keychain/Keystore | Re-login (secure, no transfer) |
| Strategy cache | localStorage | SQLite | Regenerated on first session |
| Snapshot resume | sessionStorage | SQLite | Regenerated on first session |
| Chat history | localStorage | SQLite | Available from server (coach_conversations) |

**No client-to-client data migration needed.** All persistent data is server-side.

---

## 6. Beta Testing Strategy

### iOS

1. **TestFlight** — Up to 10,000 external testers
2. Internal testing: 5-10 drivers in DFW market
3. External beta: 50-100 drivers across 3 markets
4. Monitor: crash rate (<1%), session duration, feature adoption

### Android

1. **Google Play Internal Testing** — Up to 100 testers
2. **Closed Beta** — Up to 1,000 testers
3. Same monitoring criteria as iOS

### Metrics to Track

| Metric | Target | Tool |
|--------|--------|------|
| Crash-free rate | >99% | Firebase Crashlytics |
| Session duration | >5 min avg | Firebase Analytics |
| Feature adoption (coach, strategy) | >50% of sessions | Custom events |
| Background SSE uptime | >95% | Custom heartbeat |
| Push notification open rate | >30% | APNs/FCM metrics |

---

## 7. Conversion Timeline

| Phase | Duration | Deliverable | Dependencies |
|-------|----------|-------------|-------------|
| **Phase 0: PWA** | 1 week | manifest.json + service worker | None |
| **Phase 1a: iOS Shell** | 2-4 weeks | WebView + background SSE + push + biometric | Apple Developer Account |
| **Phase 1b: Android Shell** | 2-4 weeks | WebView + foreground service + push + biometric | Play Developer Account |
| **Phase 1c: Beta** | 2 weeks | TestFlight + Play Internal Testing | Phase 1a + 1b |
| **Phase 2a: iOS Hybrid** | 4-8 weeks | Native map + strategy card + SiriKit | Phase 1a |
| **Phase 2b: Android Hybrid** | 4-8 weeks | Native map + strategy card + share intent | Phase 1b |
| **Phase 3: Full Native** | 12-24 weeks | All screens native | Phase 2 |

### Critical Path

Phase 1 (WebView shell) is the highest ROI — solves background execution (the #1 user pain point) with lowest effort.

---

## 8. Team Skill Requirements

| Phase | Skills Needed |
|-------|--------------|
| Phase 0 (PWA) | Frontend (React, service workers) |
| Phase 1 (Shell) | Swift/SwiftUI basics, Kotlin basics, native bridge patterns |
| Phase 2 (Hybrid) | Advanced Swift/Kotlin, Google Maps SDK, SSE in native |
| Phase 3 (Full) | Senior iOS + Senior Android + shared API design |

---

## 9. Current State

| Area | Status |
|------|--------|
| Web app | Working — production deployed |
| API (client-agnostic) | Working — ready for native clients |
| PWA | NOT configured |
| iOS app | NOT started |
| Android app | NOT started |
| Feature flags | Environment variables only |

---

## 10. Known Gaps

1. **No PWA** — No manifest, no service worker.
2. **Apple Sign-In missing** — Required for App Store.
3. **No push infrastructure** — No APNs/FCM server integration.
4. **No API versioning** — Breaking changes affect all clients simultaneously.
5. **No crash reporting** — No Crashlytics or similar.

---

## 11. TODO — Hardening Work

- [ ] **Phase 0: PWA basics** — manifest.json + basic service worker (1 week)
- [ ] **Phase 1a: iOS WebView shell** — Background SSE + push + biometric (2-4 weeks)
- [ ] **Phase 1b: Android WebView shell** — Foreground service + push + biometric (2-4 weeks)
- [ ] **Add Apple Sign-In** — Required for iOS App Store (before Phase 1a)
- [ ] **API versioning** — `/api/v1/*` prefix before native ships
- [ ] **Feature flag service** — DB-backed flags for gradual rollout
- [ ] **Crash reporting** — Firebase Crashlytics for both platforms

---

## Supersedes

Absorbs content from `docs/architecture/feature-management.md` (feature flags, A/B testing infrastructure).

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/constants/apiRoutes.ts` | Complete API contract for native clients |
| `server/api/hooks/analyze-offer.js` | Offer analysis (device_id auth, Siri/Android) |
| `server/api/hooks/README.md` | Siri Shortcuts documentation |
| `gateway-server.js` | Server config (deploy modes) |
