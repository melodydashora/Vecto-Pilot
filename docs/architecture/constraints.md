# Architectural Constraints

Critical rules and constraints that must be followed when working with the codebase.

## Model Parameters

### GPT-5.2 Constraints (Avoid 400 Errors)

**DO NOT USE:**
- `temperature` - Causes 400 error
- `top_p` - Causes 400 error
- `max_tokens` - Use `max_completion_tokens` instead
- Nested `reasoning` object - Use flat `reasoning_effort`

**CORRECT:**
```javascript
{
  model: "gpt-5.1",
  reasoning_effort: "medium",  // "low", "medium", "high"
  max_completion_tokens: 32000
}
```

**WRONG:**
```javascript
{ reasoning: { effort: "medium" } }  // 400: Unknown parameter
{ temperature: 0.7 }  // 400: Not supported
{ max_tokens: 1000 }  // Wrong parameter name
```

### Gemini 3 Pro Constraints

**Use nested `thinkingConfig`, NOT flat `thinking_budget`:**

```javascript
// CORRECT
{
  generationConfig: {
    thinkingConfig: { thinkingLevel: "HIGH" }
  }
}

// WRONG
{ thinking_budget: 8000 }
```

## Location & Coordinates

### GPS-First Policy
- **No fallbacks** - If browser geolocation fails, show "Location unavailable"
- **No IP-based fallback** - This is a GPS-first global app
- **No default locations** - User must enable GPS

### Coordinate Sources
Coordinates and business hours come from Google APIs or DB, **never from AI models**:

| Data | Source |
|------|--------|
| Coordinates | Google Geocoding API or DB cache |
| Business hours | Google Places API |
| Open/closed status | Google Places API |
| Distance/drive time | Google Routes API |

### Coordinate Caching
- `coords_cache` table uses 4-decimal precision (~11m accuracy)
- Key format: `${lat.toFixed(4)}_${lng.toFixed(4)}`
- Always check cache before calling external APIs

## Database Constraints

### Snapshot-Centric Design
All data links to `snapshot_id` for ML training correlation:
- `strategies` → `snapshot_id`
- `briefings` → `snapshot_id`
- `rankings` → `snapshot_id`
- `feedback` → `snapshot_id`

### Sorting Convention
- Always use `created_at DESC` (newest first) for debugging queries
- Never rely on insertion order

### Schema Changes
- Use `npm run db:push` for development
- Drizzle schema-first approach
- Schema defined in `shared/schema.js`

## Code Conventions

### Unused Variables
- Prefix with `_` (e.g., `_unused`)
- ESLint configured to allow `_` prefix

### TypeScript
- Strict mode enabled in client
- No `any` types without justification

### File Creation
Before creating new files:
1. Search for existing implementations
2. Check LESSONS_LEARNED.md
3. This repo has duplicates - verify code doesn't already exist

## Authentication

### Token Flow
1. Device generates/retrieves `device_id` from localStorage
2. POST `/api/auth/token` with `device_id`
3. Server returns JWT token
4. Client stores in `localStorage.vecto_auth_token`
5. Include in all API calls: `Authorization: Bearer <token>`

### No Password Auth
- Device-based identification only
- JWT contains `user_id` and `device_id`
- Token refresh handled automatically

## Polling & Rate Limits

### Client Polling
| Resource | Interval | Notes |
|----------|----------|-------|
| Strategy status | 3s | While status === 'pending' |
| Blocks | 5s | Until blocks arrive, then stop |
| User location | On init only | No continuous polling |

### Production Issue (Dec 1, 2025)
2s polling caused 1643 req/6h spike (30 req/min × 50 users).
**Solution:** `refetchInterval: false` - fetch on init only.

## Security

### Bot Blocker
- `server/middleware/bot-blocker.js` blocks 60+ bot patterns
- Blocks search engines, SEO tools, AI crawlers, vulnerability scanners
- Logs: `[bot-blocker] Blocked bot: "..." from <IP>`

### Input Validation
- Zod schemas for all API inputs
- `server/middleware/validation.js` handles errors
- Never trust client data

### Sensitive Files
Do not commit:
- `.env` files
- `credentials.json`
- API keys
- `keys/` directory contents

## Performance

### Timeouts
| Operation | Timeout | Notes |
|-----------|---------|-------|
| AI strategy generation | 230s | Full pipeline with buffer |
| Individual model call | 60s | Per-request timeout |
| Database query | 30s | Connection pool timeout |

### Caching
| Data | Cache Duration |
|------|----------------|
| Events | 4 hours |
| News/Closures | 24 hours (until midnight) |
| Traffic | Real-time (no cache) |
| Geocode | Permanent (in DB) |
| Weather | Per request cycle |

## Component Fixes (Do Not Revert)

### GlobalHeader.tsx
- Use `useContext(LocationContext)` directly, NOT a custom hook
- Get `refreshGPS` from: `loc?.refreshGPS ?? loc?.location?.refreshGPS`
- Priority: database → override city → context city/state

### LocationContext
- Handles ALL data fetching in parallel
- Uses `lastEnrichmentCoordsRef` for deduplication
- Uses `generationCounterRef` for race conditions

### Weather API
- Fetched ONLY in `location-context-clean.tsx`
- GlobalHeader reads from state, does NOT fetch
- Prevents duplicate API calls

## Holiday Override System

Manual override via `server/config/holiday-override.json`:
- Supports custom banners during date ranges
- Actual holidays supersede overrides
- CLI: `node server/scripts/holiday-override.js`

## Deprecated Features

**Do not use or re-implement:**
- Perplexity integration (removed Dec 2025)
- IP-based location fallback
- Password authentication
- Gesture tracking API
- Preview context API
