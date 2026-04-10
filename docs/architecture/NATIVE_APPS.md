# NATIVE_APPS.md — Swift (iOS) and Android Conversion Strategy

> **Canonical reference** for native mobile app planning: PWA limitations, Swift/Kotlin paths, shared API layer, and deployment.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Current PWA Status](#1-current-pwa-status)
2. [Why Native Is Required](#2-why-native-is-required)
3. [iOS: Swift/SwiftUI Plan](#3-ios-swiftswiftui-plan)
4. [Android: Kotlin/Compose Plan](#4-android-kotlincompose-plan)
5. [Shared API Contract](#5-shared-api-contract)
6. [Feature Parity Matrix](#6-feature-parity-matrix)
7. [Push Notification Architecture](#7-push-notification-architecture)
8. [Offline-First Data Sync](#8-offline-first-data-sync)
9. [Siri/Android Shortcuts Native Integration](#9-siriandroid-shortcuts-native-integration)
10. [Biometric Auth](#10-biometric-auth)
11. [App Store Deployment](#11-app-store-deployment)
12. [Current State](#12-current-state)
13. [Known Gaps](#13-known-gaps)
14. [TODO — Hardening Work](#14-todo--hardening-work)

---

## 1. Current PWA Status

**manifest.json:** NOT configured (file not found)
**Service Worker:** NOT configured
**Add to Home Screen:** NOT available

The web app has no PWA configuration. It's a standard SPA served by Express.

---

## 2. Why Native Is Required

| Problem | Impact | Native Solution |
|---------|--------|----------------|
| **Browser suspends background tabs** | SSE connections die when driver uses Uber/Lyft app | Background service keeps connection alive |
| **No push notifications** | Driver misses strategy updates, surge alerts | APNs (iOS) / FCM (Android) |
| **GPS stops in background** | Location stale when driver returns | Background location updates |
| **Siri Shortcuts via HTTP** | Slow (network round-trip), fragile | Native SiriKit (direct, fast) |
| **No App Store presence** | Can't distribute to drivers | iOS App Store + Google Play |
| **No biometric auth** | Password only | Face ID / fingerprint |

---

## 3. iOS: Swift/SwiftUI Plan

### Phase 1: WebView Shell (2-4 weeks)

Wrap existing React web app in native iOS shell:

```swift
// Minimum viable native shell
struct ContentView: View {
    var body: some View {
        WebView(url: "https://vectopilot.com")
            .onAppear { startBackgroundSSEService() }
    }
}
```

**Native bridges needed:**
- Background SSE connection (URLSession + EventSource)
- Push notification registration (APNs)
- Background location updates (CLLocationManager)
- Biometric auth (LocalAuthentication framework)

### Phase 2: Hybrid (1-3 months)

Replace performance-critical screens with native SwiftUI:
- Strategy card (frequently updated via SSE)
- Map (Google Maps SDK native, much faster than web)
- Offer analysis (SiriKit integration)

### Phase 3: Full Native (3-6 months)

Component-by-component migration:

| React Component | SwiftUI Equivalent |
|----------------|-------------------|
| `StrategyPage` | Native strategy view with SSE |
| `MapTab` (Google Maps JS) | Google Maps iOS SDK |
| `AICoach` (streaming) | Native SSE + message UI |
| `BarsMainTab` | Native list with Core Location |
| `BriefingPage` | Native cards |
| `TranslationOverlay` | SFSpeechRecognizer + native TTS |
| `BottomTabNavigation` | UITabBarController / TabView |

---

## 4. Android: Kotlin/Compose Plan

### Same 3-Phase Approach

1. **WebView shell** with background service (Foreground Service for SSE)
2. **Hybrid** — replace map + strategy with Compose
3. **Full native** — Jetpack Compose + Kotlin Coroutines

### Android-Specific Features

| Feature | Implementation |
|---------|---------------|
| Offer analysis | Share Intent (screenshot → Vecto) or Accessibility Service |
| Background SSE | Foreground Service with persistent notification |
| Push notifications | Firebase Cloud Messaging (FCM) |
| GPS background | Fused Location Provider |
| Biometric | BiometricPrompt API |

---

## 5. Shared API Contract

The React web app communicates via REST API (`/api/*`). Native apps use the **exact same endpoints**.

**No API changes needed.** The server is already client-agnostic. All authentication via Bearer token in Authorization header.

### Key Endpoints for Native

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `POST /api/auth/login` | Email login | None (returns token) |
| `POST /api/auth/google/exchange` | Google Sign-In | None (returns token) |
| `GET /api/location/resolve` | GPS → snapshot | Bearer token |
| `POST /api/blocks-fast` | Trigger pipeline | Bearer token |
| `GET /events/*` | SSE streams | None (stateless) |
| `POST /api/chat` | Coach (SSE streaming) | Bearer token |
| `POST /api/hooks/analyze-offer` | Offer analysis | device_id (no JWT) |
| `POST /api/translate` | Translation | Bearer token |
| `POST /api/tts` | Text-to-speech | Bearer token |

---

## 6. Feature Parity Matrix

| Feature | Web | iOS (Phase 1) | iOS (Full) | Android (Phase 1) | Android (Full) |
|---------|-----|---------------|------------|-------------------|---------------|
| Login (email) | Yes | Yes (WebView) | Yes (native) | Yes (WebView) | Yes (native) |
| Google OAuth | Yes | Yes (WebView) | Yes (ASWebAuth) | Yes (WebView) | Yes (Google Sign-In) |
| GPS + Snapshot | Yes | Yes + background | Yes + background | Yes + background | Yes + background |
| Strategy | Yes | Yes (WebView) | Yes (native SSE) | Yes (WebView) | Yes (native SSE) |
| AI Coach | Yes | Yes (WebView) | Yes (native stream) | Yes (WebView) | Yes (native stream) |
| Map | Yes | Yes (WebView) | Yes (Maps SDK) | Yes (WebView) | Yes (Maps SDK) |
| Bars/Venues | Yes | Yes (WebView) | Yes (native) | Yes (WebView) | Yes (native) |
| Translation | Yes | Yes (WebView) | Yes (SFSpeech) | Yes (WebView) | Yes (SpeechRecognizer) |
| Offer Analysis | Siri only | Siri (HTTP) | SiriKit (native) | No | Share Intent |
| Push Notifications | No | Yes (APNs) | Yes (APNs) | Yes (FCM) | Yes (FCM) |
| Background SSE | No | Yes (URLSession) | Yes (URLSession) | Yes (ForegroundSvc) | Yes (ForegroundSvc) |
| Biometric Auth | No | Yes (Face ID) | Yes (Face ID) | Yes (Fingerprint) | Yes (Fingerprint) |
| Offline Mode | Minimal | Cached display | Full offline-first | Cached display | Full offline-first |

---

## 7. Push Notification Architecture

```
Server event (strategy_ready, briefing_ready, surge_alert)
  └─ pg_notify → Push Service
       ├─ APNs → iOS devices
       └─ FCM → Android devices
```

### Notification Types

| Event | Priority | Content |
|-------|----------|---------|
| `strategy_ready` | High | "Your strategy is ready — position near [venue]" |
| `briefing_ready` | Normal | "Briefing updated: [traffic/events summary]" |
| `surge_alert` | High | "Surge detected near [area] — $X.XX/mi" |
| `offer_analyzed` | High | "ACCEPT: $X.XX at Y.Y mi — [reason]" |
| `session_expiring` | Normal | "Session expires in 10 minutes" |

---

## 8. Offline-First Data Sync

### Native Offline Storage

| Data | Storage | Sync Strategy |
|------|---------|---------------|
| Strategy text | SQLite / Core Data | Last known good, refresh on connect |
| Venue list | SQLite | Cache with 24h TTL |
| Chat history | SQLite | Sync on reconnect |
| Quick phrases (translation) | Bundled | Pre-translated in all 20 languages |
| Briefing data | SQLite | Cache with snapshot TTL |
| Driver profile | SQLite | Sync on login |

---

## 9. Siri/Android Shortcuts Native Integration

### iOS: SiriKit (Native)

Current: Siri Shortcuts → HTTP POST → server
Native: SiriKit Intent → native handler → HTTP POST

**Benefits:** Faster (no Shortcuts app overhead), more reliable, better error handling.

### Android: App Shortcuts + Share Intent

| Method | How | Effort |
|--------|-----|--------|
| **Share Intent** | Screenshot → "Share with Vecto" → analyze | Medium |
| **App Shortcuts** | Home screen shortcut → camera → analyze | Medium |
| **Accessibility Service** | Auto-detect Uber/Lyft screen → analyze | High (privacy concerns) |

---

## 10. Biometric Auth

### Implementation

```
App launch → Check biometric availability
  ├─ Face ID / Fingerprint available → Prompt
  │    ├─ Success → Load stored JWT from Keychain/Keystore
  │    └─ Failure → Fall back to email/password
  └─ Not available → Email/password login
```

**Token storage:** iOS Keychain / Android Keystore (hardware-backed encryption).

---

## 11. App Store Deployment

### iOS

| Requirement | Status |
|-------------|--------|
| Apple Developer Account ($99/yr) | Needed |
| App Review Guidelines compliance | TBD |
| Apple Sign-In (required if Google Sign-In offered) | NOT IMPLEMENTED |
| Privacy labels | Need to declare all data collection |
| TestFlight beta | For pre-launch testing |

### Android

| Requirement | Status |
|-------------|--------|
| Google Play Developer Account ($25 one-time) | Needed |
| Play Store listing | TBD |
| Android App Bundle | Standard build |
| Internal testing track | For pre-launch |

---

## 12. Current State

| Area | Status |
|------|--------|
| Web app (React) | Working — production |
| PWA | NOT configured |
| iOS native | NOT started |
| Android native | NOT started |
| API contract (client-agnostic) | Working — ready for native clients |
| Siri Shortcuts (HTTP) | Working — via web |

---

## 13. Known Gaps

1. **No PWA basics** — No manifest.json, no service worker.
2. **Apple Sign-In not implemented** — Required for App Store if Google Sign-In is offered.
3. **No push notification infrastructure** — No APNs/FCM integration.
4. **No offline data schema** — No SQLite/Core Data model defined.
5. **Android offer analysis has no path** — Siri Shortcuts is iOS-only.

---

## 14. TODO — Hardening Work

- [ ] **Phase 1: iOS WebView shell** — Background SSE + push + biometric (2-4 weeks)
- [ ] **Phase 1: Android WebView shell** — Background service + push + biometric (2-4 weeks)
- [ ] **Add Apple Sign-In** — Required for App Store submission
- [ ] **Configure PWA** — manifest.json + service worker (parallel with native)
- [ ] **Define offline data schema** — SQLite tables for cached strategy, venues, chat
- [ ] **Build Android Share Intent** — Screenshot → Vecto for offer analysis
- [ ] **Push notification service** — Server-side APNs/FCM integration

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/constants/apiRoutes.ts` | Complete API contract for native clients |
| `server/api/hooks/analyze-offer.js` | Siri endpoint (device_id auth) |
| `server/api/hooks/README.md` | Siri Shortcuts documentation |
| `client/src/hooks/useSpeechRecognition.ts` | Web Speech API (needs native equivalent) |
| `client/src/utils/co-pilot-helpers.ts` | SSE Manager (needs native equivalent) |
