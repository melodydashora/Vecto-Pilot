# Architectural Decisions

WHY we made specific choices. Read this before suggesting changes.

## Design Philosophy

### 1. Single-Path Orchestration Only

**Decision:** No fallbacks, no hedging, no router fallbacks in TRIAD.

**Why:**
- If a model fails, we want to know immediately
- Silent fallbacks hide problems and corrupt ML training data
- Debugging is easier when there's one path to trace
- Quality over availability - better to fail visibly than succeed with wrong answer

**Implementation:** `strategy-generator-parallel.js` has one path. Model unavailable = actionable error.

---

### 2. Coordinates from Google or DB, Never from AI

**Decision:** LLMs cannot generate or "correct" lat/lng coordinates.

**Why:**
- AI models hallucinate coordinates regularly
- Wrong coordinates mean drivers go to wrong places
- Google Places/Routes are authoritative sources
- Our DB cache contains verified coordinates

**Implementation:**
- `venue-enrichment.js` always uses Google APIs
- If Google unavailable, use last verified DB copy
- Otherwise fail-closed (don't guess)

---

### 3. Complete Snapshot Gating

**Decision:** No LLM call without complete location snapshot.

**Why:**
- Partial context corrupts ML training
- Incomplete data leads to bad recommendations
- "Not ready" is better than low-confidence garbage

**Required fields:** GPS, timezone, daypart, weather, AQI

**Implementation:** `get-snapshot-context.js` validates completeness before proceeding.

---

### 4. Fail-Fast, No Stub Data

**Decision:** If an API fails, the whole operation fails.

**Why:**
- Stub data ("Traffic data unavailable") looks like real data
- Users can't tell they're getting degraded results
- We'd rather show an error than misleading information
- Forces us to fix problems rather than hide them

**Implementation:** All API calls throw on failure, no fallback content.

---

### 5. Key-Based Merge, Never Index

**Decision:** Venue data merges use `place_id` or `name`, never array position.

**Why:**
- Array order can change between API calls
- Index-based merge assigned wrong data to wrong venues
- place_id is globally unique (from Google)
- name is fallback when place_id unavailable

**Implementation:** `enhanced-smart-blocks.js` uses `place_id` as primary key.

---

### 6. Server Truth for Coordinates

**Decision:** Client never overwrites server-provided venue coordinates.

**Why:**
- Server coordinates come from Google (verified)
- Client coordinates could be stale or manipulated
- Single source of truth prevents conflicts
- GPS drift on client shouldn't affect venue locations

---

### 7. Per-Route JSON Parsing

**Decision:** No global `app.use(express.json())`.

**Why:**
- Global parser caused issues with client abort errors
- Different routes need different size limits
- Per-route parsing allows custom validation
- Prevents HTML error pages on malformed JSON

**Implementation:** Each route group has its own parser:
```javascript
app.use('/api', express.json({ limit: '1mb' }));
app.use('/mcp', express.json({ limit: '1mb' }));
```

---

### 8. Model Roles, Not Model Names

**Decision:** Use "Strategist", "Briefer", "Consolidator" in logs and code.

**Why:**
- Model names change (Claude 3 → Claude 4.5 → etc.)
- Role names are stable and meaningful
- Easier to swap models without changing all references
- Logs make sense regardless of which model fills the role

---

### 9. Server Calculates isOpen with Venue Timezone

**Decision:** Server calculates venue open/closed using venue's timezone; client trusts this value.

**Why:**
- Server knows venue's timezone (e.g., "America/Chicago")
- Browser timezone ≠ venue timezone (driver traveling across timezones)
- Client-side recalculation caused late-night venues to show incorrectly as closed
- `Intl.DateTimeFormat` with venue timezone gives accurate results

**Implementation:** `BarsTable.tsx`:
```javascript
const isOpen = bar.isOpen;  // Trust server's timezone-aware calculation
```

**Historical note:** Client-side recalculation with `calculateIsOpenNow()` was removed after timezone bugs in production.

---

### 10. Same Behavior Dev and Production

**Decision:** No development-only code paths.

**Why:**
- "Works in dev" doesn't mean "works in prod"
- Cache behavior must be identical
- Testing in dev should reflect production
- Hidden dev-only bugs are the worst kind

**Historical issue:** Cache clearing was dev-only, production served stale data.

---

## Model-Specific Decisions

### GPT-5.2 Parameters

**Decision:** Use `reasoning_effort`, never `temperature`.

**Why:**
- GPT-5.2 doesn't support temperature
- Using temperature causes 400 errors
- `reasoning_effort` controls thinking depth

**Correct:**
```javascript
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }
```

**Wrong:**
```javascript
{ temperature: 0.7 }  // Causes 400 error
{ reasoning: { effort: "medium" } }  // Wrong nesting
```

### Gemini 3 Pro Configuration

**Decision:** Use `thinkingConfig` for thinking mode.

**Correct:**
```javascript
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
```

---

## Staging Area Constraint

**Decision:** Staging areas must be within 2 minutes drive of ALL recommended venues.

**Added:** October 9, 2025

**Why:**
- Driver can reach any venue quickly for ride capture
- Reduces dead time between rides
- Central positioning maximizes flexibility

**Implementation:** GPT-5.2 system prompt includes explicit CRITICAL constraint.

---

## Location Resolution Priority

**Decision:** Check users table before coords cache before Google API.

**Added:** December 2025

**Why:**
- Most requests are repeat users at same location
- Users table check is fastest (device_id match)
- Coords cache avoids API calls for nearby locations
- Google API only for true cache misses

**Flow:**
1. Users table (device_id + within 100m) → REUSE
2. Coords cache (4-decimal precision) → REUSE
3. Google Geocoding API → store result

---

## Fix Capsules

### Coordinate Persistence (October 9, 2025)

**Problem:** Venues were displayed without coordinates, breaking map and navigation.

**Root Cause:** GPT-5.2 returned venues without lat/lng, and we didn't validate.

**Fix:**
1. Added Zod validation requiring lat/lng
2. Added fallback geocoding from Google
3. Reject venues without coordinates

### Stale Briefing Data (December 8, 2025)

**Problem:** Production serving hours-old briefing data.

**Root Cause:** TTL check was wrapped in `if (development)`.

**Fix:** TTL-based expiry in ALL environments.

### Duplicate API Calls (December 7, 2025)

**Problem:** React.StrictMode causing double GPS requests.

**Root Cause:** StrictMode intentionally double-renders in dev.

**Fix:** Removed StrictMode wrapper from `main.tsx`.

---

## When to Update This Document

Add a new decision when:
- Making a non-obvious architectural choice
- Changing a pattern that might seem wrong to future developers/AI
- Fixing a bug caused by a previous "obvious" approach
- Adding a constraint that isn't intuitive

Format:
```markdown
### [Decision Name]

**Decision:** What we chose

**Why:** Reasoning (the important part)

**Implementation:** Where/how it's enforced
```

## See Also

- [Constraints](constraints.md) - Current rules
- [Deprecated](deprecated.md) - What we removed
- [AI Pipeline](ai-pipeline.md) - Model configuration
- [LESSONS_LEARNED.md](/LESSONS_LEARNED.md) - Historical issues
