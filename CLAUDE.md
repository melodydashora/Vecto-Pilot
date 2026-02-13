# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## 🚨 DEVELOPMENT PROCESS RULES (MANDATORY)

**These rules govern ALL development work. No exceptions.**

### Rule 1: Planning Before Implementation
- **BEFORE making any code changes**, create a plan document in the same directory as the relevant README.md
- Plan must include: objectives, approach, files affected, and **test cases**
- Implementation requires **formal testing approval from Melody** (human developer)
- Do NOT proceed until Melody confirms: "All tests passed"

### Rule 2: README.md Synchronization
- **Every time** files in a folder/subfolder are modified, the corresponding README.md MUST be updated
- If forgotten, use `docs/review-queue/pending.md` to track and verify later

### Rule 3: Pending.md Verification
- If `docs/review-queue/pending.md` has information, **verify those changes first**
- Ensure README.md files and root documents (CLAUDE.md, ARCHITECTURE.md, LESSONS_LEARNED.md) reflect those changes before proceeding with new work

### Rule 4: Documentation Currency
- Understand the repo in its current state before making changes
- All documentation must be **fully up to date** at all times
- When in doubt, audit and update docs first

### Rule 5: Major Code Changes - Inline Documentation
- When changing **functional blocks of code** (major changes), add inline comments with:
  - Date of change (YYYY-MM-DD)
  - Reason for the change
- Update the relevant README.md and root documents

### Rule 6: Master Architect Role
- **Do NOT blindly accept Melody's memory or advice** - act as a master architect
- Push back on decisions that don't make technical sense
- Create sub-agents (Task tool) for complex investigations
- Make logical, well-reasoned decisions with justification

### Rule 7: AI Coach Data Access (Schema Changes)
When schema changes are made, ensure the **AI Coach** has access to:
- All database tables
- Snapshot history filtered by `user_id`
- Connected static data (markets, platforms, venue catalogues)

### Rule 8: AI Coach Write Access
The AI Coach needs **write access** to capture learnings from real user interactions:

| Table | Purpose |
|-------|---------|
| `venue_catalog` | Driver-contributed venue intel (staging spots, GPS dead zones) |
| `market_intelligence` | Market-specific patterns, surge zones, timing insights |
| `user_intel_notes` | Per-user notes from driver interactions |
| `zone_intelligence` | Crowd-sourced zone knowledge (dead zones, honey holes, staging spots) |
| `coach_conversations` | Thread history for cross-session memory |
| `coach_system_notes` | **AI Coach observations** about system enhancements |
| `discovered_events` | Event deactivation/reactivation (via `is_active` flag) |
| `news_deactivations` | User news hiding preferences |

**Note:** School closures and traffic conditions are stored in `briefings.school_closures` and `briefings.traffic_conditions` (JSONB columns), not separate tables. LLM consolidation via `callModel('BRIEFING_TRAFFIC')` at `briefing-service.js:1543`.

**Use Cases (examples, not exhaustive):**
- "Give me an exact staging location central to events and high-end venues where GPS signal is not blocked"
- "Analyze surge patterns - where do surges always start/end?"
- "How can I get short hops without going far from home?"
- Capture app-specific advice (e.g., "Turn on destination filter to stay in busy area")
- Learn from driver feedback what worked vs. what didn't

### Rule 9: ALL FINDINGS ARE HIGH PRIORITY

**This repo is a "how to code with AI" reference implementation. All issues must be completely resolved.**

- **Every audit finding** (from AI assistants, code review, or human inspection) is HIGH priority
- **No "low priority" bucket** - if an issue is found, it gets fixed or explicitly documented with a timeline
- **Includes "nice to have" suggestions** like model consolidation (e.g., "use fewer models for news/events")
- **Zero tolerance for drift** between docs, schema, metadata, and code
- **Duplicate logic = bug** - if the same calculation exists in multiple places, consolidate immediately

**Tracking Requirements:**
1. All findings MUST be logged in `docs/DOC_DISCREPANCIES.md` with:
   - Unique ID (D-XXX)
   - Exact file:line location
   - What code says vs. what it should say
   - Status (PENDING/IN_PROGRESS/FIXED)
2. Findings older than 24 hours without action = escalation
3. Before closing any session, verify all findings are tracked

**Why This Matters:**
- This codebase demonstrates AI-assisted development best practices
- Stale docs/metadata cause AI assistants to hallucinate
- "Low priority" issues compound into "tables with no data" confusion
- Every discrepancy is a potential bug in AI-generated code

### Rule 10: MELODY IS THE ARCHITECT

**Claude does NOT make architecture decisions. Melody (the human) is the architect.**

- **Do NOT propose architecture changes** - wait for Melody to define the design
- **Do NOT infer how systems should connect** - ask Melody first
- **Do NOT add fields, tables, or flows** without explicit direction from Melody
- **When confused about design**, STOP and ask - don't guess
- **Your role**: Help Melody code what she decides, not decide for her

**What Claude CAN do:**
- Point out potential issues or conflicts with existing code
- Ask clarifying questions about requirements
- Suggest implementation details AFTER architecture is defined
- Execute the implementation as directed

**What Claude CANNOT do:**
- Decide how data flows between tables
- Decide which fields belong where
- Decide how UI should display data
- Make any "this makes sense so I'll do it" changes

**If you catch yourself thinking "I think this should..."** - STOP and ask Melody instead.

### Rule 11: PIPELINE DATA DEPENDENCIES (2026-01-14)

**The AI pipeline has strict data dependencies. Understand this flow:**

```
SNAPSHOT (required first)
    │
    ├── GPS location: lat, lng, formatted_address
    ├── Time context: local_iso, dow, hour, day_part_key, timezone
    └── Resolved location: city, state, country

    ↓ [BRIEFING requires SNAPSHOT]

BRIEFING ROW (requires snapshot_id)
    │
    ├── Weather: Google Weather API → briefings.weather_current/forecast
    ├── Traffic: TomTom → Gemini → briefings.traffic_conditions
    ├── Events: Gemini Discovery → briefings.events
    ├── News: Gemini Search → briefings.news
    └── Airport: Gemini Search → briefings.airport_conditions

    ↓ [STRATEGY requires SNAPSHOT + BRIEFING]

STRATEGY_FOR_NOW (requires snapshot + briefing row)
    │
    └── Consolidator receives: snapshot context + all briefing data

    ↓ [VENUES requires STRATEGY_FOR_NOW + SNAPSHOT]

VENUE RECOMMENDATIONS (requires strategy + driver location)
    │
    └── Tactical Planner: strategy text + driver GPS → scored venues
```

**Critical Dependencies:**
| Step | Requires | Error if Missing |
|------|----------|------------------|
| Briefing | `snapshot_id` with valid GPS | "Missing location data" |
| Strategy | `briefing_row` + `snapshot_row` | "Cannot generate strategy without briefing" |
| Venues | `strategy_for_now` + `snapshot.lat/lng` | "Cannot recommend venues without strategy" |

**Why This Matters:**
- Strategist AI needs briefing data to make intelligent recommendations
- Venue planner needs strategy text to score venues appropriately
- Skipping steps = garbage recommendations or cryptic errors

---

## Project Overview

Vecto Pilot is an AI-powered rideshare intelligence platform. It uses a multi-model AI pipeline (Claude Opus 4.6, Gemini 3.0 Pro, GPT-5.2) to generate venue recommendations and tactical guidance for drivers.

## Quick Start

```bash
npm run dev              # Development server (port 5000)
npm run typecheck        # TypeScript checking
npm run lint             # ESLint
npm run test             # All tests
npm run lint && npm run typecheck && npm run build  # Pre-PR
```

## Documentation Structure

**Every folder has a README.md** explaining its purpose. Start here:

### Core Documentation
| Document | Purpose |
|----------|---------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/architecture/](docs/architecture/README.md) | Architecture docs (13 focused files) |
| [docs/preflight/](docs/preflight/README.md) | **Pre-flight cards (read before edits)** |
| [docs/memory/](docs/memory/README.md) | Memory layer (session rituals) |
| [docs/ai-tools/](docs/ai-tools/README.md) | AI tools documentation |
| [docs/review-queue/](docs/review-queue/README.md) | **Change analyzer findings (check on session start)** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview + folder index |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md) | Historical issues |

### Server Folders
| Folder | Purpose |
|--------|---------|
| [server/api/](server/api/README.md) | API routes by domain |
| [server/lib/](server/lib/README.md) | Business logic |
| [server/lib/ai/](server/lib/ai/README.md) | AI adapters & providers |
| [server/db/](server/db/README.md) | Database connection |
| [server/config/](server/config/README.md) | Configuration |

### Client Folders
| Folder | Purpose |
|--------|---------|
| [client/src/](client/src/README.md) | Frontend overview |
| [client/src/components/](client/src/components/README.md) | UI components |
| [client/src/hooks/](client/src/hooks/README.md) | Custom hooks |
| [client/src/contexts/](client/src/contexts/README.md) | React contexts |
| [client/src/lib/](client/src/lib/README.md) | Core utilities |
| [client/src/utils/](client/src/utils/README.md) | Feature helpers |
| [client/src/types/](client/src/types/README.md) | TypeScript types |
| [client/src/features/](client/src/features/README.md) | Feature modules |
| [client/src/pages/](client/src/pages/README.md) | Page components |

## Available AI Tools

| Tool System | When to Use |
|-------------|-------------|
| [MCP Server](docs/ai-tools/mcp.md) | Claude Desktop integration (39 tools) |
| [Memory System](docs/ai-tools/memory.md) | Persistent cross-session storage |
| [Workspace Agent](docs/ai-tools/agent.md) | WebSocket real-time access |
| [Eidolon SDK](docs/ai-tools/eidolon.md) | Deep analysis & context awareness |
| [Assistant API](docs/ai-tools/assistant.md) | Context enrichment & web search |

**Key Memory Tools:**
```javascript
// Store a decision
await memory_store({ key: 'decision_xyz', content: '...', tags: ['decision'] });

// Search memories
await memory_search({ tags: ['decision'], limit: 10 });

// Get project context
const context = await context_get();
```

See [docs/ai-tools/README.md](docs/ai-tools/README.md) for full documentation.

## Critical Rules

### NO FALLBACKS - GLOBAL APP RULE

**This is a global application. NEVER add location fallbacks or defaults.**

```javascript
// WRONG - masks bugs, breaks global app
const city = snapshot?.city || 'Frisco';           // NO!
const timezone = snapshot?.timezone || 'America/Chicago';  // NO!
const airports = data?.airports || [{ code: 'DFW' }];      // NO!

// CORRECT - fail explicitly, let the bug surface
if (!snapshot?.city) {
  throw new Error('Missing required location data');
  // OR return { error: 'Location data not available' };
}
const city = snapshot.city;
```

**Why this matters:**
- Fallbacks **mask bugs** instead of fixing them
- Hardcoded locations break the app for users outside that region
- "Quick fixes" with defaults create technical debt that's hard to find later
- If data is missing, **that's a bug upstream** - fix the source, not the symptom

**The pattern to follow:**
1. Required data missing? **Return an error or throw**
2. Optional data missing? **Omit the feature, don't fake it**
3. Never hardcode: cities, states, countries, airports, coordinates, or timezones

### NO SILENT FAILURES - ERROR HANDLING RULE

**Never use graceful error handling that masks problems.**

```javascript
// WRONG - silently fails, masks bugs
if (res.status === 503) {
  console.debug('Service unavailable');  // NO! debug logs are invisible
  return null;  // NO! caller doesn't know something failed
}

// CORRECT - let errors surface with clear messages
if (res.status === 503) {
  throw new Error('Agent is disabled on server (AGENT_ENABLED !== true)');
}
```

**Why this matters:**
- Silent failures hide bugs until they become critical
- `console.debug` is often invisible in production logs
- Returning `null` on error makes callers assume success
- Fix the **ROOT CAUSE**, don't mask symptoms

**The pattern to follow:**
1. Error occurred? **Throw with a descriptive message**
2. Log errors with `console.error`, never `console.debug`
3. Re-throw errors so callers can handle or know something failed
4. If you're catching an error just to return null - you're masking a bug

### FAIL HARD - CRITICAL DATA RULE (2026-01-15)

**When critical data is missing, block the UI entirely. Never show partial/degraded state.**

```javascript
// WRONG - soft fallback masks bugs
if (!snapshot?.city) {
  return { city: 'Unknown Location' };  // NO! UI continues with broken state
}

// CORRECT - fail hard with blocking error
if (!snapshot?.city) {
  setCriticalError({ type: 'snapshot_incomplete', message: 'Missing city' });
  return; // CriticalError modal blocks entire dashboard
}
```

**Critical data that requires FAIL HARD:**
| Data | Why Critical | Action |
|------|--------------|--------|
| Snapshot ID | All queries depend on it | Block UI |
| City/Timezone | Strategy, events filtering | Block UI |
| GPS Coords | Maps, venue distances | Block UI |
| Auth Token | All API calls | Redirect to login |
| Ranking ID | Feedback linkage | Block UI |

**Implementation:**
- **Server**: Return 4xx/5xx errors, not 200 with empty data
- **Client**: Validate critical fields exist, throw if missing
- **UI**: `CriticalError` component replaces dashboard when `criticalError` is set
- **Timeout**: 30-second location resolution timeout in GlobalHeader

**See:** `client/src/components/CriticalError.tsx`, `LESSONS_LEARNED.md` > "FAIL HARD Pattern"

### ROOT CAUSE FIRST - INVESTIGATION RULE

**Never catch or handle errors that should be architecturally impossible.**

```javascript
// WRONG - Defensive catch that masks SQL bugs
ON CONFLICT (event_hash) DO UPDATE SET ...
} catch (err) {
  if (err.code === '23505') {
    skipped++;  // SILENT! If ON CONFLICT works, 23505 is IMPOSSIBLE
  }
}

// CORRECT - Surface unexpected errors to fix root cause
ON CONFLICT (event_hash) DO UPDATE SET ...
} catch (err) {
  if (err.code === '23505') {
    // 23505 with ON CONFLICT = SQL is WRONG, not a recoverable error
    throw new Error(`Unexpected duplicate despite ON CONFLICT: ${err.constraint}`);
  }
}
```

**Why this matters:**
- If your SQL is correct, the catch is unnecessary
- If the catch fires, your SQL is wrong - **fix the SQL, don't catch the symptom**
- Defensive catches mask real bugs and make debugging impossible
- Every error has a root cause - **find and fix it**

**The pattern to follow:**
1. Before catching an error, ask: "Should this error be possible?"
2. If architecturally impossible → **throw**, don't catch
3. Investigate WHY something failed, don't just handle the failure
4. Add inline comments explaining root cause when fixed (with date)

**Common anti-patterns:**
| Anti-Pattern | Root Cause to Fix |
|--------------|-------------------|
| Catch 23505 with ON CONFLICT | Wrong column in ON CONFLICT clause |
| Return `null` on 404 | Missing data upstream, fix the source |
| Silent retry on timeout | Connection pool exhausted, increase pool |
| Default value on missing data | Bug in data flow, trace the pipeline |

### ABSOLUTE PRECISION - GPS & DATA ACCURACY RULE

**This app requires pinpoint accuracy. No fuzzy matching, no approximations.**

```javascript
// COORDINATE PRECISION
// WRONG - 4 decimals (~11 meters, allows "close enough" matching)
const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;

// CORRECT - 6 decimals (~11 centimeters, exact location)
const key = `${lat.toFixed(6)}_${lng.toFixed(6)}`;

// COORDINATE SOURCES
// WRONG - AI-generated coordinates (hallucinated, imprecise)
const { lat, lng } = await gpt.getVenueLocation(venueName);

// CORRECT - Google APIs (authoritative, verified)
const { lat, lng } = await googlePlaces.getPlaceDetails(placeId);
```

**Why this matters:**
- Drivers depend on exact locations - "close enough" wastes their time
- Fuzzy matching serves stale data to nearby drivers
- AI models hallucinate coordinates; Google APIs verify them
- Cache keys must be exact to prevent cross-contamination

**Precision requirements:**
| Data Type | Precision | Why |
|-----------|-----------|-----|
| GPS coordinates | 6 decimals | ~11cm accuracy, prevents cache collisions |
| Cache keys | Exact match | No fuzzy/proximity matching |
| Venue matching | Google place_id | Authoritative, not name matching |
| Event deduplication | Hash of normalized fields | Exact, not similarity |

**The pattern to follow:**
1. Coordinates always from Google APIs or DB, never from AI
2. Cache keys use 6-decimal `makeCoordsKey(lat, lng)`
3. Venue identification via `place_id`, not name similarity
4. No "close enough" - if data doesn't match exactly, it's different data

### DOCUMENTATION CURRENCY - MANDATORY UPDATES

**Documentation is not optional. Every code change requires doc updates.**

```
BEFORE making changes:
├── Read the folder README.md
├── Check LESSONS_LEARNED.md for known issues
├── Review docs/preflight/*.md for area-specific rules
└── Check docs/review-queue/pending.md for outstanding items

AFTER making changes:
├── Update affected README.md files
├── Add inline comment with date and reason (major changes)
├── Update LESSONS_LEARNED.md if you discovered something non-obvious
├── Update CLAUDE.md if it affects global rules
└── Flag docs/review-queue/pending.md if unsure what to update
```

**Why this matters:**
- Outdated docs cause repeated mistakes
- Future sessions waste time rediscovering known issues
- If it's not documented, it didn't happen (for AI assistants)
- This repo has complex interdependencies - docs are the map

**Mandatory documentation triggers:**
| Change Type | Must Update |
|-------------|-------------|
| New file created | Folder README.md |
| File deleted | Folder README.md, grep for stale references |
| Bug fix with lesson | LESSONS_LEARNED.md |
| API endpoint changed | docs/architecture/api-reference.md |
| Schema changed | docs/architecture/database-schema.md |
| AI model changed | docs/preflight/ai-models.md |
| Global rule discovered | CLAUDE.md Critical Rules section |

### Model Parameters

**GPT-5.2** - Avoid 400 errors:
```javascript
// CORRECT
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }
// WRONG - causes 400
{ reasoning: { effort: "medium" } }  // Nested format
{ temperature: 0.7 }  // Not supported
```

**Gemini 3 Pro**:
```javascript
// CORRECT (Gemini 3 Pro only supports LOW or HIGH)
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
{ generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } }
// WRONG
{ generationConfig: { thinkingConfig: { thinkingLevel: "MEDIUM" } } }  // MEDIUM is Flash-only!
{ thinking_budget: 8000 }  // Deprecated
```

### Model Adapter Pattern

Always use the adapter - never call AI APIs directly:
```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('strategist', { system, user });
```

### Before Creating Files

1. **Check folder README first** - documents existing files
2. Search for existing code: `grep -r "functionName" server/`
3. Check LESSONS_LEARNED.md for known issues

### Code Conventions

- Unused variables: prefix with `_`
- TypeScript strict mode in client
- Database: link all data to `snapshot_id`
- Sorting: `created_at DESC` (newest first)

### Location Rules

- **GPS-first**: no IP fallback, no default locations, no hardcoded coordinates
- **No location fallbacks**: if location data is missing, return error (see NO FALLBACKS rule above)
- Coordinates from Google APIs or DB, never from AI
- `location-context-clean.tsx` is the single weather source
- All location data (city, state, timezone, airports) comes from user's actual GPS position

### Event Field Naming Convention (2026-01-10)

**Canonical field names for events:**

| Old Name | New Name | Notes |
|----------|----------|-------|
| `event_date` | `event_start_date` | YYYY-MM-DD format |
| `event_time` | `event_start_time` | HH:MM format (24h) or "7:00 PM" |
| N/A | `event_end_date` | For multi-day events (defaults to start date) |
| N/A | `event_end_time` | Required - no TBD/Unknown allowed |

**Pipeline enforces these names:**
```javascript
// normalizeEvent.js converts all input formats to canonical names
import { normalizeEvent } from './lib/events/pipeline/normalizeEvent.js';

const normalized = normalizeEvent({
  event_date: '2026-01-15',    // OLD: will be converted
  event_time: '7:00 PM'        // OLD: will be converted
});
// Output: { event_start_date: '2026-01-15', event_start_time: '19:00', ... }
```

**Why this matters:** Consistent field names prevent property access bugs (e.g., `event_date` vs `event_start_date` returning undefined).

### Venue Open/Closed Status

**Server-side** (`venue-enrichment.js`): `isOpen` is calculated using the **venue's timezone** via `Intl.DateTimeFormat` with snapshot timezone and stored in `ranking_candidates.features.isOpen`.

**Client-side** (`BarsTable.tsx`): Trusts server's `isOpen` value. **No client-side recalculation.**

```javascript
// Server: venue-enrichment.js - Calculates with venue timezone
// Uses Intl.DateTimeFormat with snapshot.timezone

// Client: BarsTable.tsx - Trusts server value
const isOpen = bar.isOpen;  // Trust server's timezone-aware calculation
```

**Why no client recalculation?** Browser timezone ≠ venue timezone. Client-side recalculation caused late-night venues to show as "Closed" incorrectly. Server uses the correct venue timezone.

## Pre-flight Checklist

**Before ANY edit**, read the relevant quick-reference card:

| Area | Card | Key Rules |
|------|------|-----------|
| AI/Models | [docs/preflight/ai-models.md](docs/preflight/ai-models.md) | Model parameters, adapter pattern |
| Location/GPS | [docs/preflight/location.md](docs/preflight/location.md) | GPS-first, coordinate sources |
| Database | [docs/preflight/database.md](docs/preflight/database.md) | snapshot_id linking, sorting |
| Code Style | [docs/preflight/code-style.md](docs/preflight/code-style.md) | Conventions, patterns |

### Pre-flight Workflow

```
Before ANY edit:
1. What area does this touch? (AI, database, location, UI)
2. Read the relevant preflight card (docs/preflight/*.md)
3. Grep for existing implementations
4. THEN make the change
```

## Memory Layer

Persistent memory for context across sessions. See [docs/memory/](docs/memory/README.md) for full documentation.

### Session Start

Load context at session start:
```javascript
memory_search({ tags: ["decision"], limit: 20 })  // Architecture decisions
memory_search({ tags: ["learning"], limit: 5 })   // Recent learnings
memory_retrieve({ key: "user_preferences" })       // User preferences

// Also check for pending doc reviews from Change Analyzer
Read({ file_path: "docs/review-queue/pending.md" })
```

### Session End

Store learnings before ending:
```javascript
memory_store({
  key: "session_YYYY_MM_DD_learnings",
  content: "What was learned/fixed/discovered",
  tags: ["session", "learning"],
  ttl_hours: 720
})
```

### Key Memory Prefixes

| Prefix | Purpose |
|--------|---------|
| `decision_` | Architecture decisions |
| `session_` | Session learnings |
| `user_` | User preferences |
| `debug_` | Debugging notes |

## Post-Change Documentation

After completing significant changes, ask yourself:

### Documentation Check
```
1. Does this change any documented behavior?
   → If yes, update the relevant doc in docs/architecture/ or docs/preflight/

2. Should LESSONS_LEARNED.md be updated?
   → If you discovered a non-obvious fix or pattern, add it

3. Are there new constraints to add?
   → If you found something that "must always" or "must never" be done

4. Should this be stored in memory?
   → If it's a decision, learning, or user preference
```

### When to Update Docs

| Change Type | Update |
|-------------|--------|
| New API endpoint | `docs/architecture/api-reference.md` |
| Database change | `docs/architecture/database-schema.md` |
| AI model change | `docs/preflight/ai-models.md` |
| New component | Folder README.md |
| Bug fix with lesson | `LESSONS_LEARNED.md` |
| Architecture decision | `docs/architecture/decisions.md` + memory |

### Memory Storage

```javascript
// Store significant decisions
memory_store({
  key: "decision_feature_name",
  content: "Decision details and reasoning",
  tags: ["decision", "feature_area"],
  metadata: { decided_on: "YYYY-MM-DD", reason: "..." }
})

// Flag docs needing update
memory_store({
  key: "doc_update_YYYY_MM_DD",
  content: "Which doc needs what update",
  tags: ["documentation", "todo"],
  ttl_hours: 168  // 1 week
})
```

## Change Analyzer

Automated sub-agent that runs on server startup to flag documentation that may need updates.

### How It Works

1. **Server starts** → Change Analyzer runs automatically
2. **Git analysis** → Detects modified, added, deleted files
3. **Doc mapping** → Maps changed files to potentially affected docs
4. **Output** → Appends findings to `docs/review-queue/`

### Review Queue Files

| File | Purpose |
|------|---------|
| `docs/review-queue/pending.md` | Current items needing review |
| `docs/review-queue/YYYY-MM-DD.md` | Daily analysis logs |

### Manual Trigger

```javascript
// Via MCP tool
analyze_changes
```

### Session Workflow

**At session start:**
1. Check `docs/review-queue/pending.md` for flagged items
2. Review high-priority items
3. Update docs if needed

**After reviewing:**
```markdown
// Change status in pending.md
### Status: PENDING  →  ### Status: REVIEWED
```

See [docs/review-queue/README.md](docs/review-queue/README.md) for full documentation.

## Environment Variables

### Required
```bash
DATABASE_URL=...           # PostgreSQL
OPENAI_API_KEY=...         # GPT-5.2
GEMINI_API_KEY=...         # Gemini 3.0 Pro
ANTHROPIC_API_KEY=...      # Claude Opus 4.6
GOOGLE_MAPS_API_KEY=...    # Places, Routes, Weather
```

### OAuth (Google, Uber)
```bash
GOOGLE_CLIENT_ID=...       # Google Cloud Console OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=...   # Google Cloud Console OAuth 2.0 Client Secret
UBER_CLIENT_ID=...         # Uber Developer Dashboard
UBER_CLIENT_SECRET=...     # Uber Developer Dashboard
```

### Model Configuration
```bash
STRATEGY_STRATEGIST=claude-opus-4-6-20260201
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.2
STRATEGY_EVENT_VALIDATOR=claude-opus-4-6-20260201
```

## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server |
| `shared/schema.js` | Drizzle ORM schema |
| `server/lib/ai/adapters/index.js` | Model adapter dispatcher |
| `client/src/routes.tsx` | React Router configuration |
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with GlobalHeader |
| `client/src/contexts/co-pilot-context.tsx` | Shared state for co-pilot pages |
| `client/src/contexts/location-context-clean.tsx` | Location provider |
| `client/src/components/CriticalError.tsx` | Blocking error modal (FAIL HARD) |

## AI Pipeline Summary

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator
```

See [AI Pipeline](docs/architecture/ai-pipeline.md) for details.

## Holiday Override

```bash
node server/scripts/holiday-override.js list    # List overrides
node server/scripts/holiday-override.js test    # Test detection
```

Config: `server/config/holiday-override.json`

## Complete Folder Map

### Server Structure
```
server/
├── api/                    # API routes (domain-organized)
│   ├── auth/               # Authentication endpoints
│   ├── briefing/           # Events, traffic, news, weather
│   ├── chat/               # AI Coach text/voice chat, TTS
│   ├── coach/              # AI Coach notes, schema discovery, validation
│   ├── feedback/           # User feedback, actions logging
│   ├── health/             # Health checks, diagnostics
│   ├── intelligence/       # Market intelligence, staging areas
│   ├── location/           # GPS resolution, snapshots
│   ├── platform/           # Platform stats, markets, countries
│   ├── research/           # Vector search, research
│   ├── strategy/           # Strategy generation, blocks, SSE events
│   ├── vehicle/            # Vehicle management
│   ├── venue/              # Venue intelligence, events
│   └── utils/              # HTTP helpers, timing
│
├── lib/                    # Business logic
│   ├── ai/                 # AI layer
│   │   ├── adapters/       # Model adapters (anthropic, openai, gemini)
│   │   └── providers/      # AI providers (briefing, consolidator)
│   ├── auth/               # Authentication services
│   ├── briefing/           # Briefing service
│   ├── events/             # Event ETL pipeline
│   │   └── pipeline/       # Canonical modules (normalize, validate, hash, types)
│   ├── external/           # Third-party APIs (TomTom, FAA)
│   ├── infrastructure/     # Job queue
│   ├── location/           # Geo, holiday detection, snapshot context, coords-key
│   ├── strategy/           # Strategy pipeline, providers, validation
│   ├── traffic/            # TomTom traffic API integration
│   └── venue/              # Venue intelligence, enrichment, places
│       └── hours/          # Business hours parsing and evaluation
│
├── config/                 # Configuration files
├── db/                     # Database connection, pool, migrations
├── jobs/                   # Background workers (triad-worker)
├── logger/                 # Logging utilities (ndjson, module logger)
├── middleware/             # Express middleware (auth, validation)
├── util/                   # Utilities (circuit breaker, UUID, ETA)
├── bootstrap/              # Server startup, route mounting
├── agent/                  # Workspace agent (file ops, shell, SQL)
├── eidolon/                # Enhanced SDK (memory, tools, policy)
├── assistant/              # Assistant proxy layer
├── gateway/                # Gateway proxy
├── scripts/                # Server-side scripts
├── types/                  # TypeScript types
└── validation/             # Schema validation
```

### Client Structure
```
client/src/
├── routes.tsx              # React Router configuration
├── layouts/                # Layout components
│   └── CoPilotLayout.tsx   # Shared layout with GlobalHeader + BottomNav
├── pages/                  # Route pages
│   └── co-pilot/           # Co-pilot pages (router-based)
│       ├── StrategyPage.tsx    # AI strategy + smart blocks + coach
│       ├── BarsPage.tsx        # Premium venue listings
│       ├── BriefingPage.tsx    # Weather, traffic, news, events
│       ├── MapPage.tsx         # Venue + event map
│       ├── IntelPage.tsx       # Rideshare intel
│       ├── AboutPage.tsx       # About/donation (no header)
│       └── index.tsx           # Barrel export
├── components/             # UI components
│   ├── co-pilot/           # Co-pilot specific (BottomTabNavigation, greeting)
│   ├── intel/              # Rideshare intelligence display (7 components)
│   ├── strategy/           # Strategy display components
│   ├── ui/                 # shadcn/ui primitives (46 components)
│   └── _future/            # Staged components
├── contexts/               # React contexts
│   ├── co-pilot-context.tsx    # Shared state for co-pilot pages
│   └── location-context-clean.tsx # Location provider (GPS, weather)
├── hooks/                  # Custom hooks
│   ├── useBriefingQueries.ts   # Fetches weather, traffic, news
│   ├── useEnrichmentProgress.ts # Tracks briefing progress
│   ├── useStrategyLoadingMessages.ts # Strategy loading messages
│   ├── useStrategyPolling.ts   # Strategy polling with SSE
│   ├── useStrategy.ts          # Strategy state management
│   ├── useVenueLoadingMessages.ts # Venue loading messages
│   ├── useTTS.ts               # Text-to-speech with OpenAI
│   └── use-toast.ts            # Toast notifications
├── features/               # Feature modules
│   └── strategy/           # Strategy feature
├── lib/                    # Core utilities (daypart, queryClient)
├── types/                  # TypeScript types
├── utils/                  # Feature helpers (co-pilot-helpers.ts)
└── _future/                # Staged future features
    ├── engine/             # Reflection engine (Phase 17)
    └── user-settings/      # User profile types
```

### Co-Pilot Route Structure
```
/                         → Redirects to /co-pilot/strategy
/co-pilot                 → Redirects to /co-pilot/strategy
/co-pilot/strategy        → StrategyPage (AI + blocks + coach)
/co-pilot/bars            → VenueManagerPage (venue listings)
/co-pilot/briefing        → BriefingPage (weather, traffic, news)
/co-pilot/map             → MapPage (interactive map)
/co-pilot/intel           → IntelPage (rideshare intel)
/co-pilot/settings        → SettingsPage (user preferences)
/co-pilot/about           → AboutPage (no GlobalHeader)
/co-pilot/policy          → PolicyPage (privacy policy)
```

### Auth Route Structure
```
/auth/sign-in             → SignInPage (email/password login)
/auth/sign-up             → SignUpPage (multi-step registration)
/auth/forgot-password     → ForgotPasswordPage (request reset)
/auth/reset-password      → ResetPasswordPage (reset with token)
/auth/terms               → TermsPage (terms of service)
/auth/google/callback     → GoogleCallbackPage (Google OAuth code exchange)
/auth/uber/callback       → UberCallbackPage (Uber OAuth code exchange)
```

### Root Structure
```
/
├── gateway-server.js       # Main Express server entry
├── strategy-generator.js   # Background strategy worker
├── sdk-embed.js            # SDK router factory
├── shared/schema.js        # Drizzle ORM database schema
├── docs/architecture/      # API reference, database, AI pipeline
├── tests/                  # Test suites (e2e, unit)
└── tools/                  # Development utilities
```

## Key Import Patterns

```javascript
// AI adapters (always use this, never call APIs directly)
import { callModel } from '../../lib/ai/adapters/index.js';

// Database
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';

// Logging - workflow-aware
import { triadLog, venuesLog, briefingLog, eventsLog } from '../../logger/workflow.js';

// Events ETL Pipeline (2026-01-10: Uses canonical field names event_start_date/event_start_time)
import { normalizeEvent, normalizeEvents } from '../../lib/events/pipeline/normalizeEvent.js';
import { validateEventsHard, needsReadTimeValidation } from '../../lib/events/pipeline/validateEvent.js';
import { generateEventHash, eventsHaveSameHash } from '../../lib/events/pipeline/hashEvent.js';

// Coordinate Key (canonical 6-decimal precision for cache keys)
import { makeCoordsKey, coordsKey, parseCoordKey } from '../../lib/location/coords-key.js';

// Snapshot context
import { getSnapshotContext } from '../../lib/location/get-snapshot-context.js';

// Strategy providers
import { providers } from '../../lib/strategy/providers.js';
```

## Logging Conventions

### Use Workflow Logger for Pipeline Operations

```javascript
import { triadLog, venuesLog } from '../../logger/workflow.js';

// TRIAD pipeline (strategy generation)
triadLog.phase(1, `Starting for ${snapshotId.slice(0, 8)}`);
triadLog.done(1, `Saved (706 chars)`);

// VENUES pipeline (venue enrichment)
venuesLog.start(`Dallas, TX (${snapshotId.slice(0, 8)})`);
venuesLog.phase(2, `Routes API: calculating distances`);
venuesLog.done(2, `5 venues enriched`, 348);
venuesLog.complete(`5 venues for Dallas, TX`, 78761);
```

### Venue-Specific Logs (Critical for Debugging)

Always include the **venue name** so you can trace which venue is being processed:

```javascript
// GOOD - Can trace "The Mitchell" through the pipeline
console.log(`🏢 [VENUE "The Mitchell"] Calculating route from driver...`);
console.log(`🏢 [VENUE "The Mitchell"] Route: 5.2mi, 12min`);
console.log(`🏢 [VENUE "The Mitchell"] ✅ placeId=YES, status=OPEN, hours=5:00 PM - 2:00 AM`);

// BAD - Generic, can't trace which venue has the issue
console.log(`[Venue Enrichment] ✅ Distance: 5.2 mi`);
```

### No Model Names in Logs

Use **role names** (Strategist, Briefer, Consolidator) not model names (Claude, Gemini, GPT-5.2):

```javascript
// GOOD - Role-based
triadLog.phase(1, `Starting for ${snapshotId}`);  // Shows: [TRIAD 1/4 - Strategist]

// BAD - Model-specific (confusing, changes when models swap)
console.log(`[minstrategy] Starting Claude Opus for snapshot`);
```

### Workflow Phases Reference

| Component | Phases | Labels |
|-----------|--------|--------|
| TRIAD | 4 | Strategist, Briefer, Daily+NOW Strategy, SmartBlocks |
| VENUES | 4 | Tactical Planner, Routes API, Places API, DB Store |
| BRIEFING | 3 | Traffic, Events Discovery, Event Validation |
| EVENTS | 5 | Extract\|Providers, Transform\|Normalize, Transform\|Geocode, Load\|Store, Assemble\|Briefing |

### EVENTS ETL Pipeline Logger

For event discovery/sync operations, use `eventsLog`:

```javascript
import { eventsLog, OP } from '../../logger/workflow.js';

// Phase 1: Extract - Provider calls (SerpAPI, Gemini, Claude)
eventsLog.phase(1, `Calling SerpAPI for ${city}`, OP.API);

// Phase 2: Transform - Normalization + Validation
eventsLog.phase(2, `Normalized ${events.length} events`, OP.NORMALIZE);

// Phase 3: Transform - Geocode + Venue Linking
eventsLog.phase(3, `Geocoding ${events.length} events`, OP.API);

// Phase 4: Load - Upsert to discovered_events
eventsLog.phase(4, `Upserting ${events.length} events`, OP.DB);

// Phase 5: Assemble - Query from DB for briefings
eventsLog.phase(5, `Assembled ${events.length} events for briefing`);
```

See `server/logger/README.md` for full documentation.

## Related Files

- `REORGANIZATION_PLAN.md` - Codebase organization status
- `LESSONS_LEARNED.md` - Historical issues (read before changes)
- Can we add the button in the UI to match the fetch daily strategy on briefing tab?