# Technical Debt & Incomplete Features Analysis

> Generated: 2025-12-29
> Status: Pending Review

---

## TEMPORARY CHANGES (Revert After Testing)

### AI Coach Authentication Bypass (Dec 2025)

**File:** `server/api/chat/chat.js`

**Current State:** Changed from `requireAuth` to `optionalAuth` to allow anonymous users access during signup testing.

**What to Revert:**
```javascript
// Line 8: Change back to only requireAuth
import { requireAuth } from '../../middleware/auth.js';

// Line 127: Change back to requireAuth
router.post('/', requireAuth, async (req, res) => {
```

**When to Revert:** After sign-up/sign-in flow is fully tested and working.

**Why:** AI Coach should require authentication for registered users to:
- Track conversation history per user
- Personalize responses based on user profile
- Enable premium features for registered users

---

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Incomplete Features | 3 | High |
| Dead Code | 8 | Medium |
| Lint Fixes | 1 | Low |

---

## Incomplete Features (Requires Design Decision)

### 1. Block Selection Route Builder

**Files:**
- [`client/src/pages/co-pilot/StrategyPage.tsx`](client/src/pages/co-pilot/StrategyPage.tsx)

**Status:** Feature is 90% implemented but never wired to UI

**What Exists:**
| Component | Location | Status |
|-----------|----------|--------|
| `selectedBlocks` state | Line 74 | Working |
| `toggleBlockSelection()` function | Lines 160-183 | Implemented, never called |
| `buildRoute()` function | Lines 185-201 | Implemented |
| Selection controls UI | Lines 217-249 | Shows when `selectedBlocks.size > 0` |
| Block cards | Lines 446-716 | Missing onClick handler |

**What's Missing:**
- Block cards have no `onClick` to call `toggleBlockSelection(index)`
- No visual indication of selected state on cards
- No checkbox or selection affordance in card UI

**Code Analysis:**
```typescript
// Line 160-183: Function exists but is never called
const toggleBlockSelection = (blockIndex: number) => {
  const block = blocks[blockIndex];
  if (!block) return;
  // ... full implementation exists
};

// Lines 446-716: Card has no onClick
<Card
  key={index}
  className={`border-2 shadow-md...`}  // No selected state styling
  data-testid={`block-${index}`}
  // onClick={() => toggleBlockSelection(index)}  // MISSING!
>
```

**To Complete This Feature:**
1. Add `onClick={() => toggleBlockSelection(index)}` to Card component (line ~448)
2. Add selected state styling: `${selectedBlocks.has(index) ? 'ring-2 ring-blue-500' : ''}`
3. Consider adding a checkbox in the card header
4. Test the full flow: select blocks → see controls → build route

**Alternative: Remove Feature:**
1. Remove `selectedBlocks` state (line 74)
2. Remove `toggleBlockSelection` function (lines 160-183)
3. Remove `buildRoute` function (lines 185-201)
4. Remove `clearSelections` function (lines 203-209)
5. Remove selection controls UI (lines 217-249)
6. Remove `dwellTimers` state and related IntersectionObserver code

---

### 2. Closed Venue Reasoning Enrichment

**Files:**
- [`client/src/contexts/co-pilot-context.tsx`](client/src/contexts/co-pilot-context.tsx)

**Status:** State exists, read logic exists, but population logic is missing

**What Exists:**
| Component | Location | Status |
|-----------|----------|--------|
| `enrichedReasonings` state | Line 83 | Created, always empty |
| `setEnrichedReasonings` setter | Line 83 | Never called |
| Read logic in blocks mapping | Lines 366-375 | Tries to read from empty map |

**Code Analysis:**
```typescript
// Line 83: State created but setter never used
const [enrichedReasonings, setEnrichedReasonings] = useState<Map<string, string>>(new Map());

// Lines 366-375: Reads from map that's always empty
const blocks = (blocksData?.blocks || []).map(block => {
  if (!block.isOpen && !block.closed_venue_reasoning) {
    const key = `${block.name}-${block.coordinates.lat}-${block.coordinates.lng}`;
    const reasoning = enrichedReasonings.get(key);  // Always undefined!
    if (reasoning) {
      return { ...block, closed_venue_reasoning: reasoning };
    }
  }
  return block;
});
```

**Original Intent:**
When a venue is closed but the backend didn't provide a `closed_venue_reasoning`, the client was supposed to:
1. Detect the missing reasoning
2. Fetch/generate one (perhaps via AI endpoint)
3. Store in `enrichedReasonings` map
4. Display in UI

**Backend Already Provides:**
- [`server/api/strategy/blocks-fast.js:218`](server/api/strategy/blocks-fast.js) sends `closed_venue_reasoning: c.closed_reasoning`
- This client enrichment may have been a fallback that became unnecessary

**To Complete This Feature:**
1. Add a `useEffect` that detects closed venues without reasoning
2. Call an API endpoint to generate reasoning
3. Store results via `setEnrichedReasonings`

**Alternative: Remove Feature:**
1. Remove `enrichedReasonings` state (line 83)
2. Simplify blocks mapping to not check enrichedReasonings (lines 366-375)

---

### 3. Strategy Progress Phase Caps

**Files:**
- [`client/src/hooks/useEnrichmentProgress.ts`](client/src/hooks/useEnrichmentProgress.ts)

**Status:** Constant defined but never used in calculations

**What Exists:**
```typescript
// Lines 60-71: Defined but never referenced
const STRATEGY_CARD_CAPS: Record<PipelinePhase, number> = {
  starting: 100,
  resolving: 100,
  analyzing: 100,
  immediate: 100,
  venues: 100,
  routing: 100,
  places: 100,
  verifying: 100,
  enriching: 100,
  complete: 100
};
```

**Original Intent:**
Cap the strategy progress display at certain percentages per phase (e.g., don't show 100% until actually complete). The constant exists but `calculateDynamicProgress()` doesn't use it.

**To Complete This Feature:**
1. Apply caps in `calculateDynamicProgress()` function
2. Use `Math.min(calculatedProgress, STRATEGY_CARD_CAPS[currentPhase])`

**Alternative: Remove:**
1. Delete lines 60-71

---

## Dead Code (Safe to Remove)

### 4. Unused Imports in auth-context.tsx

**File:** [`client/src/contexts/auth-context.tsx`](client/src/contexts/auth-context.tsx)

**Lines:** 6, 8

**Issue:** `User` and `DriverVehicle` are imported but never directly used. They're referenced via `AuthState` which already includes them.

```typescript
// Line 5-13: Remove User and DriverVehicle from import
import type {
  User,           // REMOVE - used via AuthState
  DriverProfile,
  DriverVehicle,  // REMOVE - used via AuthState
  AuthState,
  LoginCredentials,
  RegisterData,
  AuthApiResponse
} from '@/types/auth';
```

**Fix:**
```typescript
import type {
  DriverProfile,
  AuthState,
  LoginCredentials,
  RegisterData,
  AuthApiResponse
} from '@/types/auth';
```

---

### 5. Unused Imports in co-pilot-context.tsx

**File:** [`client/src/contexts/co-pilot-context.tsx`](client/src/contexts/co-pilot-context.tsx)

**Line:** 4

**Issue:** `useCallback` imported but never used

```typescript
// Line 4: Remove useCallback
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
```

**Fix:**
```typescript
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
```

---

### 6. Unused State Variables in co-pilot-context.tsx

**File:** [`client/src/contexts/co-pilot-context.tsx`](client/src/contexts/co-pilot-context.tsx)

**Issues:**

| Variable | Line | Problem |
|----------|------|---------|
| `strategySnapshotId` | 76 | Set in 3 places, never read |
| `lastStatusRef` | 86 | Assigned, never updated or read |

```typescript
// Line 76: Set but never read
const [strategySnapshotId, setStrategySnapshotId] = useState<string | null>(null);
// Used at lines 168, 182, 262 but the value is never consumed

// Line 86: Never used
const lastStatusRef = useRef<'idle' | 'ready' | 'paused'>('idle');
```

**Fix:** Either:
- Remove both if not needed
- Or implement the intended functionality (expose `strategySnapshotId` in context value)

---

### 7. Unused Import in useEnrichmentProgress.ts

**File:** [`client/src/hooks/useEnrichmentProgress.ts`](client/src/hooks/useEnrichmentProgress.ts)

**Line:** 5

**Issue:** `useCallback` imported but never used

```typescript
// Line 5: Remove useCallback
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
```

**Fix:**
```typescript
import { useState, useEffect, useMemo, useRef } from 'react';
```

---

### 8. Unused Variable in ResetPasswordPage.tsx

**File:** [`client/src/pages/auth/ResetPasswordPage.tsx`](client/src/pages/auth/ResetPasswordPage.tsx)

**Line:** 34

**Issue:** `navigate` is assigned but success flow uses `<Link>` component instead

```typescript
// Line 34: Assigned but never used
const navigate = useNavigate();

// Line 106-114: Success uses <Link> not navigate()
<Link to="/auth/sign-in">
  <Button>Sign In</Button>
</Link>
```

**Fix Options:**
1. Remove: `const navigate = useNavigate();`
2. Or prefix: `const _navigate = useNavigate();` (if keeping for future)
3. Or use: Replace `<Link>` with `navigate('/auth/sign-in')` after timeout

---

### 9. Unused Imports in StrategyPage.tsx

**File:** [`client/src/pages/co-pilot/StrategyPage.tsx`](client/src/pages/co-pilot/StrategyPage.tsx)

**Lines:** 12, 21, 38

**Issues:**

| Import | Line | Status |
|--------|------|--------|
| `TrendingUp` | 12 | Icon never used in JSX |
| `Filter` | 21 | Icon never used in JSX |
| `queryClient` | 38 | Assigned but never called |

```typescript
// Lines 9-22: Remove TrendingUp and Filter
import {
  MapPin,
  Navigation,
  TrendingUp,  // REMOVE
  Clock,
  // ...
  Filter       // REMOVE
} from 'lucide-react';

// Line 38: Remove if not needed
const queryClient = useQueryClient();  // Never used
```

---

## Lint Fixes

### 10. @ts-ignore in calendar.tsx

**File:** [`client/src/components/ui/calendar.tsx`](client/src/components/ui/calendar.tsx)

**Line:** 3

**Issue:** ESLint requires `@ts-expect-error` instead of `@ts-ignore`

```typescript
// Line 3: Current
// @ts-ignore - react-day-picker v9 type compatibility issue

// Fix:
// @ts-expect-error - react-day-picker v9 type compatibility issue
```

**Why:** `@ts-expect-error` will error if the type issue is fixed, preventing stale suppressions.

---

## Action Items Checklist

### High Priority (Incomplete Features)
- [ ] Decide: Complete or remove block selection feature in StrategyPage.tsx
- [ ] Decide: Complete or remove enrichedReasonings in co-pilot-context.tsx
- [ ] Decide: Use or remove STRATEGY_CARD_CAPS in useEnrichmentProgress.ts

### Medium Priority (Dead Code Cleanup)
- [ ] Remove unused imports from auth-context.tsx (User, DriverVehicle)
- [ ] Remove useCallback from co-pilot-context.tsx
- [ ] Remove/fix strategySnapshotId and lastStatusRef in co-pilot-context.tsx
- [ ] Remove useCallback from useEnrichmentProgress.ts
- [ ] Fix navigate in ResetPasswordPage.tsx
- [ ] Remove TrendingUp, Filter, queryClient from StrategyPage.tsx

### Low Priority (Lint)
- [ ] Change @ts-ignore to @ts-expect-error in calendar.tsx

---

## Commands to Verify Fixes

```bash
# Run type checker
npm run typecheck

# Run linter
npm run lint

# Run both
npm run lint && npm run typecheck
```
## Melody's TODO

---

### 1. [ ] Finish setting up Twilio for forgot password

**Implementation Plan:**
1. Create Twilio account and get credentials (Account SID, Auth Token, Phone Number)
2. Add environment variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
3. Update `server/lib/auth/sms.js` - currently has placeholder functions
4. Wire up `POST /api/auth/forgot-password` to send SMS when user has phone but no email

**Files to Modify:**
- `server/lib/auth/sms.js` - Implement `sendPasswordResetSMS()` using Twilio SDK
- `server/api/auth/auth.js` - Uncomment/enable SMS path in forgot-password endpoint
- `.env` - Add Twilio credentials

**Test Cases:**
- [ ] SMS sent when user requests password reset via phone number
- [ ] SMS contains valid reset code (6 digits)
- [ ] Reset code expires after 15 minutes
- [ ] Invalid phone number returns friendly error
- [ ] Rate limiting: max 3 SMS per hour per phone number
- [ ] Verify Twilio error handling (invalid number, blocked, etc.)

---

### 2. [ ] Make sure intel connection to db is setup correctly

**Implementation Plan:**
1. Check `server/api/research/` endpoints for proper DB connections
2. Verify `market_intelligence` and `user_intel_notes` tables are being read/written
3. Ensure CoachDAL's `getMarketIntelligence()` and `getUserNotes()` work end-to-end

**Files to Check:**
- `server/lib/ai/coach-dal.js` - `getMarketIntelligence()`, `getUserNotes()`
- `server/api/research/` - Intel endpoints
- `shared/schema.js` - Verify `market_intelligence`, `user_intel_notes` schemas

**Test Cases:**
- [ ] Query `market_intelligence` by city/state returns data
- [ ] Query `user_intel_notes` by user_id returns user's notes
- [ ] Insert new intel note and verify it persists
- [ ] Coach references intel notes in responses (check logs for "times_referenced" increment)
- [ ] Empty city returns empty array, not error

---

### 3. [ ] Add market map with boundaries to intel page

**Implementation Plan:**
1. Create new component: `client/src/components/intel/MarketMap.tsx`
2. Use Google Maps JavaScript API with polygon boundaries
3. Query `platform_data` table for market boundaries (need to add boundary data first)
4. Show Core/Satellite/Rural regions with different colors
5. Display driver's current position and home location

**Files to Create/Modify:**
- `client/src/components/intel/MarketMap.tsx` (NEW)
- `client/src/pages/co-pilot/IntelPage.tsx` - Add MarketMap component
- `shared/schema.js` - Add `boundary_geojson` column to `platform_data` if needed
- `server/api/platform/index.js` - Add endpoint to get market boundaries

**Dependencies:**
- `@react-google-maps/api` package
- Market boundary GeoJSON data (need to source/create)

**Test Cases:**
- [ ] Map renders centered on driver's current location
- [ ] Core region displays in green
- [ ] Satellite regions display in yellow
- [ ] Rural regions display in red/orange
- [ ] Clicking region shows market name and stats
- [ ] Map handles missing boundary data gracefully
- [ ] Mobile responsive (touch zoom/pan)

---

### 4. [ ] Verify Coach Activate/Deactivate for showing events on the map

**Implementation Plan:**
1. Add state to track "active" events the coach has recommended
2. When coach mentions an event, add it to `activeEvents` array
3. MapPage reads `activeEvents` from context and shows markers
4. Coach can say "deactivate" or user can tap to dismiss

**Files to Modify:**
- `client/src/contexts/co-pilot-context.tsx` - Add `activeEvents` state
- `client/src/pages/co-pilot/MapPage.tsx` - Render active event markers
- `server/api/chat/chat.js` - Parse coach responses for event mentions
- `client/src/components/CoachChat.tsx` - Handle activate/deactivate commands

**Data Structure:**
```typescript
interface ActiveEvent {
  id: string;
  name: string;
  venue: string;
  coordinates: { lat: number; lng: number };
  start_time: string;
  end_time: string;
  activatedAt: Date;
}
```

**Test Cases:**
- [ ] Coach mentions event → event appears on map with marker
- [ ] User says "deactivate X" → marker removed
- [ ] Coach says "check out the game at AT&T Stadium" → marker added
- [ ] Events auto-deactivate after end_time passes
- [ ] Multiple events can be active simultaneously
- [ ] Tapping event marker shows event details popup

---

### 5. [ ] Events table active filter (now data only)

**Implementation Plan:**
1. Add `is_active` computed field based on event timing
2. Filter events: `start_time - staging_time <= NOW <= end_time + buffer`
3. Exclude events starting more than 5 hours from now (unless within drive time)
4. Consider driver's location for drive time calculation

**Formula:**
```
is_active = (
  start_time - 2_hours <= NOW AND
  end_time + 30_minutes >= NOW AND
  (start_time <= NOW + drive_time + staging_time)
)
```

**Files to Modify:**
- `server/lib/venue/event-matcher.js` - Add active filter logic
- `server/api/briefing/events.js` - Apply filter before returning events
- `shared/schema.js` - Consider adding `is_active` boolean column (computed on write)

**Test Cases:**
- [ ] Event starting in 30 minutes shows as active
- [ ] Event starting in 6 hours does NOT show (unless close enough to drive)
- [ ] Event that ended 10 minutes ago still shows (cleanup buffer)
- [ ] Event that ended 1 hour ago does NOT show
- [ ] Tomorrow's events do NOT show in today's active list
- [ ] Events in driver's market prioritized over distant events

---

### 6. [ ] Model script runs on server startup with model.md sync

**Implementation Plan:**
1. Create `server/scripts/sync-models.js` to parse MODEL.md
2. Create `models` table: `id`, `name`, `provider`, `max_tokens`, `supports_temperature`, `supports_reasoning`, `updated_at`
3. Call sync script in `gateway-server.js` after server starts
4. Adapters can query `models` table for parameter validation

**Files to Create/Modify:**
- `server/scripts/sync-models.js` (NEW) - Parse MODEL.md, update DB
- `shared/schema.js` - Add `models` table schema
- `gateway-server.js` - Call `syncModels()` on startup
- `server/lib/ai/adapters/index.js` - Optional: validate against models table

**Model Table Schema:**
```javascript
export const models = pgTable("models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),  // "gpt-5.2", "claude-opus-4-5"
  provider: text("provider").notNull(),   // "openai", "anthropic", "google"
  role: text("role"),                      // "strategist", "briefer", etc.
  max_tokens: integer("max_tokens"),
  supports_temperature: boolean("supports_temperature").default(false),
  supports_reasoning: boolean("supports_reasoning").default(false),
  reasoning_param: text("reasoning_param"),  // "reasoning.effort" or "thinkingConfig.thinkingLevel"
  updated_at: timestamp("updated_at").defaultNow(),
});
```

**Test Cases:**
- [ ] Server startup logs "Models synced: 5 models updated"
- [ ] MODEL.md changes → models table updates on restart
- [ ] Query `models` table returns all configured models
- [ ] Invalid model name throws helpful error with valid options
- [ ] Adapters reject unsupported parameters (e.g., temperature for GPT-5.2)

---

### 7. [ ] event_verifier.js greyed out event in return function

**Implementation Plan:**
1. Locate the greyed out (commented) code in `event_verifier.js`
2. Determine if it should be enabled or removed
3. If enabled: uncomment and test
4. If removed: delete the dead code

**Files to Check:**
- `server/lib/ai/providers/event_verifier.js` or similar
- Search: `grep -r "greyed\|commented\|TODO" server/lib/*event*`

**Test Cases:**
- [ ] Event verification returns expected fields
- [ ] No commented code remains that should be active
- [ ] Function returns consistent structure

---

### 8. [ ] UI Mapping in list0repo-files.js runs on startup

**Implementation Plan:**
1. Locate `list0repo-files.js` and understand its purpose
2. Identify greyed out constants
3. Integrate into server startup sequence
4. Store UI mapping results in memory or DB for quick access

**Files to Check:**
- `server/scripts/list0repo-files.js` or similar
- `gateway-server.js` - Add startup call

**Test Cases:**
- [ ] Script runs without error on startup
- [ ] UI mapping available via API or context
- [ ] Greyed out constants either enabled or removed

---

### 9. [ ] CLAUDE.md instructions for repo analysis

**Implementation Plan:**
Add section to CLAUDE.md instructing Claude Code to:
1. On first session, scan entire repo structure
2. Update README.md files in each folder if outdated
3. Identify 3 potential enhancements or errors
4. Document findings in ISSUES.md

**Add to CLAUDE.md:**
```markdown
## First Session Ritual

When starting a new session, Claude Code should:

1. **Scan Repository Structure**
   - Run `find . -name "*.md" -type f | head -50` to see existing docs
   - Check each folder's README.md is current

2. **Document Findings**
   - Create/update `ISSUES.md` with:
     - 3 potential enhancements
     - 3 potential bugs or errors
     - Date discovered

3. **Keep READMEs Current**
   - If folder contents changed, update the README
   - Focus on: server/, client/src/, docs/
```

**Test Cases:**
- [ ] CLAUDE.md contains first session ritual section
- [ ] ISSUES.md exists with documented findings
- [ ] READMEs reflect current folder contents

---

### 10. [ ] Update lexicon with better terms

**Terms to Define/Rename:**
| Current Term | Proposed Term | Definition |
|--------------|---------------|------------|
| SmartBlocks | Strategy Venues | Venues shown on Strategy tab |
| coords_cache | location_cache | Cached GPS → address resolutions |
| Bar venues | Bar Tab Venues | Venues on Bars tab (may overlap with Strategy) |
| Event venues | Event-Linked Venues | Venues with associated events |

**Implementation Plan:**
1. Create `docs/LEXICON.md` with official terminology
2. Update code comments to use consistent terms
3. Update UI labels if user-facing
4. Keep both terms in lexicon (old → new mapping)

**Files to Create/Modify:**
- `docs/LEXICON.md` (NEW) - Official terminology
- Update comments in key files as encountered

**Test Cases:**
- [ ] LEXICON.md exists with all term definitions
- [ ] Terms are consistent in docs/
- [ ] New developers can understand terminology

---

### 11. [ ] Add language preferences in user settings

**Implementation Plan:**
1. Add `languages_spoken` JSONB column to `driver_profiles`
2. Update SignUpPage with language checkboxes
3. Update SettingsPage to edit languages
4. Coach uses language preferences for tips (multilingual rider advice)

**Schema Change:**
```javascript
// shared/schema.js - Add to driver_profiles
languages_spoken: jsonb("languages_spoken").default(sql`'["en"]'`),
// Example: ["en", "es", "asl"]
```

**Language Options:**
| Code | Language | Rationale |
|------|----------|-----------|
| `en` | English | Default |
| `es` | Spanish | Essential in almost every US market |
| `ar` | Arabic | High value for airport runs (Detroit, NYC) |
| `hi` | Hindi | Common in tech hubs |
| `ur` | Urdu | Common in tech hubs |
| `zh` | Mandarin/Cantonese | West Coast, international business |
| `pt` | Portuguese | Florida, Northeast |
| `fr` | French | Canadian travelers |
| `asl` | ASL (Sign Language) | Crucial accessibility feature |

**Files to Modify:**
- `shared/schema.js` - Add `languages_spoken` column
- `server/api/auth/auth.js` - Handle languages in registration/profile update
- `client/src/pages/auth/SignUpPage.tsx` - Add language checkboxes
- `client/src/pages/co-pilot/SettingsPage.tsx` - Add language editing
- `server/lib/ai/coach-dal.js` - Include languages in profile data

**UI Implementation:**
```tsx
<FormField name="languages">
  <FormLabel>Languages Spoken</FormLabel>
  <div className="grid grid-cols-2 gap-2">
    <Checkbox id="en" checked disabled /> English (Default)
    <Checkbox id="es" /> Spanish
    <Checkbox id="ar" /> Arabic
    <Checkbox id="hi" /> Hindi
    <Checkbox id="ur" /> Urdu
    <Checkbox id="zh" /> Mandarin/Cantonese
    <Checkbox id="pt" /> Portuguese
    <Checkbox id="fr" /> French
    <Checkbox id="asl" /> ASL (Sign Language)
  </div>
  <FormDescription>
    Select languages you can converse fluently in.
    Multilingual drivers earn more tips!
  </FormDescription>
</FormField>
```

**Test Cases:**
- [ ] User can select multiple languages during signup
- [ ] Languages saved to `driver_profiles.languages_spoken`
- [ ] SettingsPage shows current languages with edit capability
- [ ] Coach sees languages in profile context
- [ ] Coach mentions language advantage when relevant (e.g., airport pickup)
- [ ] ASL drivers flagged for hearing-impaired rider matching (future)
- [ ] Default `["en"]` if no selection made
---

## Related Documentation

- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) - Add findings after resolution
- [docs/review-queue/pending.md](docs/review-queue/pending.md) - Track review status
