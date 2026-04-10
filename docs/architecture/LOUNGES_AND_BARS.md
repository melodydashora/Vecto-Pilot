# LOUNGES_AND_BARS.md — Lounge and Bar Features

> **Canonical reference** for how lounges and bars are discovered, filtered, scored, and presented to drivers.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Discovery Flow](#1-discovery-flow)
2. [Filtering and Classification](#2-filtering-and-classification)
3. [Scoring and Ranking](#3-scoring-and-ranking)
4. [Open/Closed Status and Time-Based Logic](#4-openclosed-status-and-time-based-logic)
5. [Integration with Venues System](#5-integration-with-venues-system)
6. [Client-Side Presentation](#6-client-side-presentation)
7. [Current State](#7-current-state)
8. [Known Gaps](#8-known-gaps)
9. [TODO — Hardening Work](#9-todo--hardening-work)

---

## 1. Discovery Flow

### Client Trigger

**Hook:** `client/src/hooks/useBarsQuery.ts`

```
useBarsQuery({ latitude, longitude, city, state, timezone, isLocationResolved })
  └─ GET /api/venues/nearby?lat=&lng=&city=&state=&radius=25&timezone=
  └─ Cache: 5-min staleTime, 10-min gcTime, no refetch on focus
  └─ Returns: { venues: Venue[], lastCallVenues: Venue[] }
```

Prefetched as soon as location resolves — data available before user navigates to Bar Tab.

### Server Processing

**File:** `server/api/venue/venue-intelligence.js`
**Auth:** `requireAuth`

```
GET /api/venues/nearby
  ├─ 1. Query venue_catalog (DB-first, no Google API call)
  │    └─ Filter: is_bar=true OR expense_rank >= 2, within radius
  │    └─ Haversine distance calculation
  │
  ├─ 2. Exclude unwanted venues (hardcoded blocklist)
  │
  ├─ 3. VENUE_FILTER classification (Claude Haiku)
  │    └─ P (PREMIUM) / S (STANDARD) / X (REMOVE)
  │
  ├─ 4. Calculate open/closed status per venue's timezone
  │
  └─ 5. Transform to API format (toApiVenueData)
       └─ Separate lastCallVenues (closing within 60 min)
```

---

## 2. Filtering and Classification

### Hardcoded Exclusion List

Removed before AI classification: McDonald's, Wendy's, Burger King, Taco Bell, Chick-fil-A, Starbucks, Dunkin', Kroger, Walmart, Target, Shell, Chevron, ice cream shops, frozen yogurt, smoothie bars.

### VENUE_FILTER (Haiku) Classification

**Model:** `VENUE_FILTER` → Claude Haiku 4.5 | maxTokens: 300 | temp: 0

| Tier | Label | Criteria | Action |
|------|-------|----------|--------|
| P | PREMIUM | Upscale lounges, cocktail bars, rooftop bars, hotel bars, speakeasies, high-end nightclubs | Show with premium badge |
| S | STANDARD | Sports bars, casual pubs, breweries, taphouses | Show normally |
| X | REMOVE | Fast food, pizza, coffee, casual chains, non-bar restaurants | Filter out |

---

## 3. Scoring and Ranking

### Venue Data Model

```typescript
interface Venue {
  name: string;
  type: 'bar' | 'nightclub' | 'wine_bar' | 'lounge';
  address: string;
  phone: string | null;
  expenseLevel: string;           // $, $$, $$$, $$$$
  expenseRank: number;            // 1-4
  isOpen: boolean | null;
  opensInMinutes: number | null;
  hoursToday: string | null;
  closingSoon: boolean;
  minutesUntilClose: number | null;
  crowdLevel: 'low' | 'medium' | 'high';
  ridesharePotential: 'low' | 'medium' | 'high';
  rating: number | null;         // Google rating
  lat, lng: number;
  placeId: string;
  venueQualityTier: 'premium' | 'standard' | null;
  closedGoAnyway: boolean;       // High-value even when closed
  closedReason: string | null;   // "Opens in 30 min"
}
```

### Sorting

Bars sorted by: quality tier (premium first), then expense rank (higher first), then distance (closest first).

---

## 4. Open/Closed Status and Time-Based Logic

### Canonical Hours Calculation

```
Google weekdayDescriptions → parseGoogleWeekdayText() → getOpenStatus()
```

**Returns:**
- `is_open`: boolean | null (null = hours unavailable)
- `hours_today`: "4:00 PM – 2:00 AM"
- `closing_soon`: true if closing within 60 minutes
- `minutes_until_close`: integer
- `opens_in_minutes`: integer (for closed venues opening soon)

**Critical:** Requires venue's timezone. Without it, returns null (unknown).

### Happy Hour Detection

**Current status:** NOT IMPLEMENTED. No explicit happy hour detection exists. The system returns full-day hours and open/closed status. Happy hour times could be sourced from venue_events or Google Places data in the future.

### Last Call Venues

Venues where `closingSoon === true` and `minutesUntilClose < 60` are extracted into a separate `lastCallVenues[]` array. These represent imminent bar closure — a driver positioning opportunity.

---

## 5. Integration with Venues System

### Relationship to SmartBlocks

The Bar Tab (`/api/venues/nearby`) and SmartBlocks (`/api/blocks-fast`) are **independent systems**:

| Feature | Bar Tab | SmartBlocks |
|---------|---------|-------------|
| Data source | `venue_catalog` DB query | VENUE_SCORER AI + Google enrichment |
| Trigger | Location resolved | Snapshot + waterfall pipeline |
| Latency | <1 second (DB query) | 35-90 seconds (full pipeline) |
| Scope | Bars/lounges only | All venue types (airports, hotels, etc.) |
| AI involvement | Haiku for classification | GPT-5.4 for scoring, Gemini for events |
| Updates | Refresh on new location | Refresh on new snapshot |

### Shared Infrastructure

Both systems use:
- `venue_catalog` table as canonical venue store
- Google Places API for hours/status
- `parseGoogleWeekdayText()` for hours calculation
- Same coordinate system and distance calculation

---

## 6. Client-Side Presentation

### Bar Tab Component

**File:** `client/src/components/BarsMainTab.tsx`

**Displays per venue:**
- Venue name + type badge (bar, nightclub, wine_bar, lounge)
- Expense tier ($–$$$$)
- Open status: green checkmark (open), "Opens in X min" (closed), red "Closing soon"
- Phone number (clickable `tel:` link)
- Navigation button (Apple Maps on iOS, Google Maps elsewhere)
- Crowd level badge
- Rideshare potential indicator

### BarsDataGrid Component

**File:** `client/src/components/BarsDataGrid.tsx`

Sortable table view: Name, Type, Hours, Distance, Value Grade, Actions (Navigate, Call).

---

## 7. Current State

| Area | Status |
|------|--------|
| DB-first bar discovery | Working — fast (<1s) |
| Haiku classification (P/S/X) | Working |
| Open/closed calculation | Working (requires timezone) |
| Last call detection | Working (60-min window) |
| Prefetch on location resolve | Working |
| Premium venue highlighting | Working |

---

## 8. Known Gaps

1. **No happy hour detection** — System doesn't know about happy hour times, specials, or promotions.
2. **No live crowd data** — `crowdLevel` is static/estimated, not real-time (Google Popular Times not integrated).
3. **No event-at-bar detection** — Bar Tab doesn't show if a venue has a live music event or DJ set tonight.
4. **No driver earnings correlation** — No data on which bars actually produce rides.
5. **Classification runs on every request** — Haiku is called per request, not cached per venue.

---

## 9. TODO — Hardening Work

- [ ] **Integrate Google Popular Times** — Show real-time crowd levels from Google Places
- [ ] **Add event-at-bar badges** — Cross-reference discovered_events with bar venues
- [ ] **Cache Haiku classification** — Store P/S/X tier in venue_catalog, only re-classify on data change
- [ ] **Add happy hour data** — Source from Google Places or venue_events
- [ ] **Track ride production per venue** — Correlate offer_intelligence with venue proximity
- [ ] **Add "near me" quick filter** — Show only bars within 5-min drive

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/hooks/useBarsQuery.ts` | Client bar data hook |
| `server/api/venue/venue-intelligence.js` | Bar discovery + Haiku filtering |
| `client/src/components/BarsMainTab.tsx` | Bar Tab UI |
| `client/src/components/BarsDataGrid.tsx` | Table view |
| `shared/schema.js` (venue_catalog) | Venue master table |
