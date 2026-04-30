# Plan: Briefing System Critical + High Bug Fixes

**Date:** 2026-04-04
**Scope:** Fix C-1 to C-5 (critical) + H-1, H-3, H-6, H-8 (high)
**Files Affected:**
- `server/lib/briefing/index.js` (C-1)
- `server/api/briefing/briefing.js` (C-2, C-3, H-1, H-8)
- `server/lib/briefing/briefing-service.js` (C-4, C-5, H-6)
- `server/lib/ai/model-registry.js` (H-3)

---

## Critical Fixes

### C-1: Fix barrel exports
- **File:** `server/lib/briefing/index.js`
- **Change:** Rename exports to match actual function names
- `fetchTrafficBriefing` → `fetchTrafficConditions`
- `fetchEventsBriefing` → `fetchEventsForBriefing`
- `fetchNewsBriefing` → `fetchRideshareNews`

### C-2: Add missing import + fix parameter shape
- **File:** `server/api/briefing/briefing.js`
- **Change:** Add `fetchTrafficConditions` to import; fix `/traffic/realtime` to pass `{ snapshot: {...} }` shape; remove NO FALLBACKS violations (city || 'Unknown', state || '')

### C-3: Fix weather realtime parameter shape
- **File:** `server/api/briefing/briefing.js`
- **Change:** `/weather/realtime` passes `{ lat, lng }` but function expects `{ snapshot }`. Fix to `{ snapshot: { lat, lng } }`

### C-4: Pass city/state context to normalizeEvent
- **File:** `server/lib/briefing/briefing-service.js` line 1197
- **Change:** `normalizeEvent(e)` → `normalizeEvent(e, { city, state })`

### C-5: Use timezone-aware date in fetchEventsForBriefing
- **File:** `server/lib/briefing/briefing-service.js` lines 1179-1182
- **Change:** Replace UTC `toISOString().split('T')[0]` with timezone-aware `toLocaleDateString('en-CA', { timeZone: timezone })` (matches pattern used in other functions)

## High Fixes

### H-1: Add market authorization to event deactivation/reactivation
- **File:** `server/api/briefing/briefing.js` lines 933, 1001
- **Change:** Verify user's market matches event's city/state before allowing deactivation

### H-3: Add briefing roles to FALLBACK_ENABLED_ROLES
- **File:** `server/lib/ai/model-registry.js` line 402
- **Change:** Add `BRIEFING_WEATHER`, `BRIEFING_TRAFFIC`, `BRIEFING_SCHOOLS`, `BRIEFING_AIRPORT`

### H-6: Update ON CONFLICT to write event content
- **File:** `server/lib/briefing/briefing-service.js` lines 1272-1278
- **Change:** Add title, venue_name, address, event times, category to ON CONFLICT SET

### H-8: Remove source_model references
- **File:** `server/api/briefing/briefing.js` lines 652, 769
- **Change:** Remove `source_model` access; use static source string

---

## Test Cases

- [ ] Barrel import: `import { fetchTrafficConditions } from './briefing/index.js'` resolves
- [ ] `/traffic/realtime?lat=32.7&lng=-96.8&city=Dallas&state=TX&timezone=America/Chicago` returns data
- [ ] `/weather/realtime?lat=32.7&lng=-96.8` returns weather
- [ ] Events normalized with city/state from snapshot context
- [ ] Event date range uses user timezone, not UTC
- [ ] Non-owner user cannot deactivate events outside their market
- [ ] Gemini outage on weather falls back to cross-provider
- [ ] Re-discovered event with corrected data updates content
- [ ] Events response has no undefined `source_model` field
