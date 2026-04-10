# USER_PREFERENCES.md — User Preferences and Personalization

> **Canonical reference** for preference storage, types, influence on strategy/coach/venues, learning, and onboarding.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Preference Storage Schema](#1-preference-storage-schema)
2. [Preference Types](#2-preference-types)
3. [How Preferences Influence the System](#3-how-preferences-influence-the-system)
4. [Preference Learning from Behavior](#4-preference-learning-from-behavior)
5. [Onboarding Flow](#5-onboarding-flow)
6. [Settings UI](#6-settings-ui)
7. [Current State](#7-current-state)
8. [Known Gaps](#8-known-gaps)
9. [TODO — Hardening Work](#9-todo--hardening-work)

---

## 1. Preference Storage Schema

### `driver_profiles` Table

**File:** `shared/schema.js` (lines 933–1027)

#### Identity
- `first_name`, `last_name`, `driver_nickname` (custom greeting)
- `email` (unique), `phone` (nullable for OAuth)
- `google_id` (unique, for Google OAuth)

#### Location
- `address_1`, `address_2`, `city`, `state_territory`, `zip_code`, `country`
- `home_lat`, `home_lng` (geocoded)
- `home_formatted_address`, `home_timezone` (IANA)
- `market` (rideshare market name)

#### Platform
- `rideshare_platforms` (jsonb array: `['uber', 'lyft', 'ridehail', 'private']`)

#### Vehicle Eligibility (platform-agnostic taxonomy)
- `elig_economy` (default true), `elig_xl`, `elig_xxl`, `elig_comfort`, `elig_luxury_sedan`, `elig_luxury_suv`

#### Vehicle Attributes
- `attr_electric`, `attr_green`, `attr_wav` (wheelchair accessible), `attr_ski`, `attr_car_seat`

#### Service Preferences (unchecked = avoid these rides)
- `pref_pet_friendly`, `pref_teen`, `pref_assist` (door-to-door for seniors), `pref_shared`

#### Account
- `marketing_opt_in`, `terms_accepted`, `terms_accepted_at`, `terms_version`
- `email_verified`, `phone_verified`, `profile_complete`

### `driver_vehicles` Table

- `vehicle_id` (UUID PK), `driver_id` (FK), `year`, `make`, `model`, `color`, `seatbelts`

---

## 2. Preference Types

| Category | Fields | Where Used |
|----------|--------|------------|
| **Home location** | `home_lat`, `home_lng`, `home_timezone`, `market` | GPS fallback, market resolution, distance-from-home calculations |
| **Vehicle class** | `elig_economy` through `elig_luxury_suv` | Coach context (today), strategy (NOT YET) |
| **Vehicle attributes** | `attr_electric`, `attr_green`, `attr_wav`, etc. | Coach context |
| **Service preferences** | `pref_pet_friendly`, `pref_teen`, `pref_assist`, `pref_shared` | Coach context |
| **Platform** | `rideshare_platforms` | Coach context, market intelligence filtering |
| **Vehicle details** | Year, make, model, color, seatbelts | Coach context, concierge profile |
| **Nickname** | `driver_nickname` | Coach greeting, concierge public name |

---

## 3. How Preferences Influence the System

### Coach (Full Access)

The Coach DAL (`getDriverProfile()`) fetches ALL preferences and injects them into the system prompt. The Coach can:
- Reference vehicle class: "Since you're XL-eligible..."
- Respect platform: "Your Uber acceptance rate..."
- Use home location for distance context
- Reference nickname for personal greeting

### Strategy (NOT YET INTEGRATED)

**Current gap:** The strategy generation prompt (`consolidator.js`) does NOT receive driver preferences. An economy-only driver gets the same tactical advice as an XL-eligible driver.

### Venue Scoring (NOT YET INTEGRATED)

**Current gap:** Venue scoring in `tactical-planner.js` and `venue-intelligence.js` does not factor in driver preferences. All drivers see the same venue rankings regardless of vehicle class or service preferences.

### GPS Fallback

When GPS fails or is unavailable, `home_lat`/`home_lng` from the profile is used as fallback coordinates in `location-context-clean.tsx`.

---

## 4. Preference Learning from Behavior

### Explicit Learning: Coach Notes

**Table:** `user_intel_notes`

The AI Coach saves learned preferences via `[SAVE_NOTE]` action tags:

```json
{
  "note_type": "preference",
  "title": "Prefers evening shifts",
  "content": "Driver consistently works 6 PM - 2 AM, avoids morning shifts",
  "importance": 80,
  "category": "timing"
}
```

**Note types:** `preference`, `insight`, `tip`, `feedback`, `pattern`, `market_update`
**Categories:** `timing`, `location`, `strategy`, `vehicle`, `earnings`, `safety`

Notes are injected into the Coach's context on every request, allowing personalization to accumulate over sessions.

### Implicit Learning: Actions and Feedback

**Table:** `actions` — Tracks dwell time, clicks, and venue selections
**Table:** `venue_feedback` — Thumbs up/down on venue recommendations
**Table:** `strategy_feedback` — Thumbs up/down on strategy advice
**Table:** `venue_metrics` — Aggregated: times_recommended, times_chosen, reliability_score

These signals are available in the Coach context but are NOT currently used to auto-adjust preferences or scoring weights.

---

## 5. Onboarding Flow

### Registration Endpoint

**Route:** `POST /api/auth/register`
**File:** `server/api/auth/auth.js` (lines 63–530)

### Data Collected at Registration

1. **Identity:** firstName, lastName, email, phone, password
2. **Location:** address1, address2, city, stateTerritory, zipCode, country
3. **Market:** market (from dropdown or custom entry)
4. **Vehicle:** vehicleYear, vehicleMake, vehicleModel, seatbelts
5. **Platforms:** ridesharePlatforms (multi-select)
6. **Eligibility:** elig_economy through elig_luxury_suv (checkboxes)
7. **Attributes:** attr_electric, attr_green, attr_wav, attr_ski, attr_car_seat
8. **Service prefs:** pref_pet_friendly, pref_teen, pref_assist, pref_shared
9. **Terms:** termsAccepted (required boolean)

### Validation at Registration

- Password strength: 8+ chars, 1 uppercase, 1 lowercase, 1 digit
- Phone: E.164 format validation
- Address: Google Address Validation API + geocoding → `home_lat`, `home_lng`
- Email: Uniqueness check
- Market: Looked up in `platform_data` table

### Google OAuth Onboarding

**Route:** `POST /api/auth/google/exchange`

New OAuth users get `profile_complete = false`. They have name and email from Google but are **missing**: address, vehicle, preferences. The client does NOT currently enforce profile completion — this is a known gap.

---

## 6. Settings UI

**File:** `client/src/pages/co-pilot/SettingsPage.tsx`

### Editable Fields

- **Personal:** nickname, phone
- **Location:** Full address, city, state, zip, country, market
- **Vehicle:** Year, make, model, seatbelts
- **Platforms:** Multi-select (Uber, Lyft, etc.)
- **Eligibility:** Vehicle class checkboxes
- **Attributes:** Vehicle attribute checkboxes
- **Service preferences:** Service type checkboxes
- **Marketing opt-in**

### Update Flow

Form uses React Hook Form + Zod validation → `PUT /api/auth/profile` → updates `driver_profiles` table.

---

## 7. Current State

| Area | Status |
|------|--------|
| Profile storage (driver_profiles) | Working — all fields populated at registration |
| Settings page (edit preferences) | Working — all fields editable |
| Coach context injection | Working — full profile available to Coach |
| Home location GPS fallback | Working |
| Coach note-based learning | Working — saves and recalls preferences |
| Google OAuth partial profile | Working — but profile_complete not enforced |

---

## 8. Known Gaps

1. **Preferences NOT injected into strategy prompt** — Vehicle class, platform, service preferences don't influence strategy recommendations.
2. **Preferences NOT used in venue scoring** — All drivers see the same venue rankings.
3. **No implicit preference learning** — Action/feedback data collected but not auto-processed into preferences.
4. **Google OAuth incomplete profile** — New OAuth users skip vehicle/address/preferences. Not enforced.
5. **No schedule-based preferences** — Driver's typical work hours not stored or used for proactive recommendations.
6. **No preference evolution tracking** — No history of when preferences changed.

---

## 9. TODO — Hardening Work

- [ ] **Inject preferences into strategy prompt** — Vehicle eligibility, service prefs, platforms should shape recommendations
- [ ] **Inject preferences into venue scoring** — Weight venues by driver's vehicle class and service preferences
- [ ] **Enforce OAuth profile completion** — Redirect incomplete profiles to finish setup before using app
- [ ] **Add schedule preferences** — Store typical work hours, use for proactive "your shift starts in 30 min" alerts
- [ ] **Auto-learn from behavior** — If driver consistently chooses Grade A venues near airports, auto-adjust scoring weights
- [ ] **Preference change history** — Track when and what preferences changed for debugging
- [ ] **Preference export** — Allow drivers to export their full preference profile

---

## Key Files

| File | Purpose |
|------|---------|
| `shared/schema.js` (lines 933–1027) | `driver_profiles` table schema |
| `server/api/auth/auth.js` (lines 63–530) | Registration + profile update |
| `server/lib/ai/coach-dal.js` (`getDriverProfile`) | Coach context injection |
| `client/src/pages/co-pilot/SettingsPage.tsx` | Settings UI |
| `server/api/coach/notes.js` | Learned preference storage |
