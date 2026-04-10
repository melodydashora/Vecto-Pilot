# CONCIERGE.md — Concierge / Share Mode Architecture

> **Canonical reference** for the passenger-facing concierge system: share tokens, public endpoints, data exposure, and relation to main auth.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Share Token System](#1-share-token-system)
2. [Public Endpoints (Passenger-Facing)](#2-public-endpoints-passenger-facing)
3. [Authenticated Endpoints (Driver-Facing)](#3-authenticated-endpoints-driver-facing)
4. [Data Exposure Model](#4-data-exposure-model)
5. [Concierge Search (DB-First + Gemini Fallback)](#5-concierge-search-db-first--gemini-fallback)
6. [Concierge Chat (Streaming Q&A)](#6-concierge-chat-streaming-qa)
7. [Auth Model: Concierge vs Main App](#7-auth-model-concierge-vs-main-app)
8. [Client-Side Pages](#8-client-side-pages)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Share Token System

**File:** `server/lib/concierge/concierge-service.js` (lines 82–118)

### Token Generation

```javascript
const token = crypto.randomBytes(6).toString('base64url'); // 8 characters
// Stored in: driver_profiles.concierge_share_token (varchar 12)
```

### Token Lifecycle

| Action | Endpoint | Auth | Effect |
|--------|----------|------|--------|
| Generate | `POST /api/concierge/token` | requireAuth | Creates 8-char token, stores in profile |
| View | `GET /api/concierge/token` | requireAuth | Returns current token + profileId |
| Revoke | `DELETE /api/concierge/token` | requireAuth | Nulls token, public profile returns 404 |
| Validate | Internal `validateShareToken()` | N/A | Looks up driver by token, attaches to request |

### Token Properties

- **Format:** 8-character base64url (cryptographically random)
- **Expiration:** None — permanent until revoked
- **Scope:** All public `/api/concierge/p/:token/*` endpoints
- **Revocation:** Driver can revoke at any time; immediate effect

### Token Validation Middleware

```javascript
async function validateShareToken(req, res, next) {
  const { token } = req.params;
  if (!token || token.length > 12) return res.status(400);
  const profile = await getDriverPublicProfile(token);
  if (!profile) return res.status(404);
  req.conciergeProfile = profile;
  next();
}
```

---

## 2. Public Endpoints (Passenger-Facing)

All prefixed with `/api/concierge/p/:token/`. All require valid share token. All rate-limited by IP.

| Endpoint | Method | Rate Limit | Purpose |
|----------|--------|------------|---------|
| `/api/concierge/p/:token` | GET | 20/min | Get driver's public profile |
| `/api/concierge/p/:token/weather` | GET | 10/min | Current weather + AQI at passenger location |
| `/api/concierge/p/:token/explore` | POST | 5/min | Search venues/events near location |
| `/api/concierge/p/:token/ask` | POST | 3/min | Q&A about local area (non-streaming) |
| `/api/concierge/p/:token/ask-stream` | POST | 3/min | Q&A with streaming response (SSE) |
| `/api/concierge/p/:token/feedback` | POST | 2/min | Submit 1-5 star rating + comment |

---

## 3. Authenticated Endpoints (Driver-Facing)

All require `requireAuth`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/concierge/token` | GET | Get current share token |
| `/api/concierge/token` | POST | Generate new share token |
| `/api/concierge/token` | DELETE | Revoke share token |
| `/api/concierge/preview` | GET | Preview own public card |
| `/api/concierge/feedback` | GET | View aggregate passenger ratings |

---

## 4. Data Exposure Model

### Public Profile (Exposed to Passengers)

```json
{
  "name": "driver_nickname OR first_name",
  "vehicle": { "year": 2024, "make": "Toyota", "model": "Camry", "seatbelts": 5 }
}
```

### Hidden Fields (NEVER Exposed)

- Email, last name, full address, home coordinates
- Phone number (removed 2026-04-10, security fix H-2)
- User ID, preferences, payment info
- Auth token, session data

---

## 5. Concierge Search (DB-First + Gemini Fallback)

**File:** `server/lib/concierge/concierge-service.js` (lines 250–697)

### Search Filters

| Filter | Event Categories | Venue Types | Search Terms |
|--------|-----------------|-------------|-------------|
| `all` | any | any | events, concerts, music, comedy, sports, bars |
| `bars` | nightlife | bar, nightclub, wine_bar | bars, cocktails, lounges, happy hour |
| `live_music` | concert, festival | bar, nightclub | live music, acoustic, DJ sets |
| `comedy` | theater | any | comedy, stand-up, open mic |
| `late_night` | any | restaurant | late night food, diners |
| `sports` | sports | stadium, bar | sports bars, games |

### Search Flow

```
1. Query venue_catalog (10-mile bounding box, filtered by types)
2. Query discovered_events (10-mile box, today only, filtered by category)
3. If combined results < 3 → Gemini fallback
   └─ callModel('CONCIERGE_SEARCH', { location, filter, searchTerms })
   └─ New discoveries persisted to DB (non-blocking)
4. Merge: DB results first (verified), then Gemini results
5. Return with source: 'db' | 'gemini' | 'db+gemini'
```

---

## 6. Concierge Chat (Streaming Q&A)

### Model

`CONCIERGE_CHAT` → Gemini 3.1 Pro Preview | thinkingLevel: LOW | Google Search enabled

### System Prompt

- Identifies as local area AI assistant
- Provides: current date/time, location coordinates, timezone
- Includes nearby venues/events already shown
- Rules: Be concise (<200 words), helpful, recommend specific venues, no driver topics

### Security

- Client-supplied context truncated to 2000 chars (H-2 fix)
- Instruction-like patterns stripped from user context
- No PII leaked in responses

---

## 7. Auth Model: Concierge vs Main App

| Property | Main App | Concierge (Public) |
|----------|----------|-------------------|
| Auth type | JWT token (userId.hmacSignature) | Share token (8-char base64url) |
| Storage | localStorage | URL path parameter |
| Session | Server-side (users table, TTL-enforced) | None — stateless |
| User identity | Authenticated driver (user_id) | Anonymous passenger |
| Rate limiting | Global 100/min per IP | Per-endpoint: 2-20/min per IP |
| Token expiry | Session: 60-min sliding + 2-hr hard | Never (until revoked) |
| Token revocation | Logout or session expiry | Driver deletes token |
| Data access | Full (all tables) | Read-only: venues, events, weather |
| Write access | Full via Coach action tags | Feedback only |

---

## 8. Client-Side Pages

### Driver Concierge Tab

**File:** `client/src/pages/co-pilot/ConciergePage.tsx`

- View/generate QR code with share token URL
- Preview own public profile card
- View aggregate passenger feedback (avg rating, total reviews, comments)
- Generate/revoke share token

### Public Passenger Page

**File:** `client/src/pages/concierge/PublicConciergePage.tsx`
**Route:** `/c/:token` (short URL for QR code)

- **Top bar:** Branding + location + weather + AQI
- **Driver banner:** Expandable name + vehicle details
- **Main content:** Chat interface (AskConcierge component)
- **Explore:** Filter buttons (all, bars, live_music, comedy, late_night, sports)
- **Map:** Google Maps with venue/event markers (ConciergeMap component)
- **Location:** Browser geolocation API for passenger position

---

## 9. Current State

| Area | Status |
|------|--------|
| Share token generation/revocation | Working |
| Public profile (name + vehicle only) | Working |
| Venue/event search (DB + Gemini) | Working |
| Streaming Q&A (Gemini) | Working |
| Passenger feedback (1-5 stars) | Working |
| Rate limiting on all public endpoints | Working |
| Token validation middleware | Working (2026-04-10 fix) |
| PII removal from public profile | Working (2026-04-10 fix) |

---

## 10. Known Gaps

1. **Share tokens never expire** — A leaked QR code provides permanent access until the driver manually revokes.
2. **No analytics on concierge usage** — Driver can't see how many passengers scanned the QR code.
3. **No passenger language detection** — Concierge always responds in English.
4. **No offline support** — Requires network for every interaction.
5. **Feedback not linked to specific rides** — Star ratings are anonymous and unlinked to trip data.
6. **Google OAuth users may lack vehicle data** — Concierge profile could be empty if OAuth user hasn't completed settings.

---

## 11. TODO — Hardening Work

- [ ] **Add token expiration** — Optional TTL (e.g., 24 hours) for temporary shares
- [ ] **Add concierge analytics** — Track scans, searches, feedback per token
- [ ] **Multi-language concierge** — Detect passenger language, respond accordingly
- [ ] **Link feedback to rides** — Associate ratings with trip timestamps
- [ ] **Enforce vehicle data for concierge** — Block QR generation if profile_complete is false
- [ ] **Add concierge tips/tipping** — Enable in-app tipping from concierge page

---

## Key Files

| File | Purpose |
|------|---------|
| `server/api/concierge/concierge.js` | All concierge routes (487 lines) |
| `server/lib/concierge/concierge-service.js` | Core logic: search, chat, tokens (960 lines) |
| `client/src/pages/co-pilot/ConciergePage.tsx` | Driver concierge tab |
| `client/src/pages/concierge/PublicConciergePage.tsx` | Passenger public page |
| `client/src/components/concierge/AskConcierge.tsx` | Chat component |
| `client/src/components/concierge/ConciergeMap.tsx` | Map with markers |
