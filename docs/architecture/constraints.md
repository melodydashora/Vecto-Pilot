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
- `coords_cache` table uses 6-decimal precision (~0.11m accuracy)
- Key format: `${lat.toFixed(6)}_${lng.toFixed(6)}`
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

### Token Flow (Registered Users)
1. User registers via `/api/auth/register` or logs in via `/api/auth/login`
2. Server returns JWT token
3. Client stores in `localStorage.vectopilot_auth_token`
4. Include in all API calls: `Authorization: Bearer <token>`

**Note:** The legacy `/api/auth/token` endpoint is DISABLED in production (returns 403).

### Anonymous Users
- No JWT token required
- Access controlled via snapshot ownership
- Snapshot ID passed in API URL paths

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

## AI Model Configuration (Binding Contract)

### Lowest Temperature / Highest Thinking Rule

All AI calls MUST use:
- **Lowest temperature available** (0 or disable if not supported)
- **Highest thinking/reasoning level** appropriate for the task

| Model | Temperature | Thinking/Reasoning |
|-------|-------------|-------------------|
| Claude Opus 4.5 | N/A (not configurable) | Extended thinking enabled |
| GPT-5.2 | N/A (not supported) | `reasoning_effort: "high"` |
| Gemini 3 Pro | N/A (not supported) | `thinkingLevel: "HIGH"` |

### AI Call Logging (Mandatory)

Every LLM call MUST log effective configuration to prove compliance:

```javascript
// Required log fields for every AI call
console.log(JSON.stringify({
  phase: 'llm_call',
  model_id: 'claude-opus-4-5-20251101',  // Actual model ID used
  role: 'STRATEGY_CORE',                  // Role from model-registry
  reasoning_effort: 'high',               // GPT-5 specific
  thinking_level: 'HIGH',                 // Gemini specific
  max_tokens: 32000,
  snapshot_id: snapshotId,
  correlation_id: reqId,
  timestamp: new Date().toISOString()
}));
```

### Adapter Enforcement

All LLM calls MUST go through `callModel()`:

```javascript
// CORRECT - Use adapter
import { callModel } from '../lib/ai/adapters/index.js';
const result = await callModel('STRATEGY_CORE', { system, user });

// WRONG - Direct API call
await fetch('https://api.openai.com/v1/chat/completions', ...);
```

**Files allowed to call LLM APIs directly:**
- `server/lib/ai/adapters/*.js` - Adapters themselves
- `server/api/chat/realtime.js` - WebSocket protocol
- `tests/**/*.js` - Test mocks

All other files MUST use the adapter pattern.

---

## Deprecated Features

**Do not use or re-implement:**
- Perplexity integration (removed Dec 2025)
- IP-based location fallback
- Password authentication
- Gesture tracking API
- Preview context API
