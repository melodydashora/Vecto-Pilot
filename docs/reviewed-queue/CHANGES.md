# Historical Change Log

This file consolidates all documented changes from the review-queue system. Organized in reverse chronological order (newest first). Used as persistent memory for the codebase evolution.

---

## 2026-01-06

**Commits:** `e7ff4af`, `8706d13`, `a8ad8ea`, `1ca8c6e`, `95bd2b6`

### Security & Critical Fixes
- **CRITICAL:** Fixed destructive cascade deletes in database schema
- Added SECURITY.md documentation
- Fixed Haiku model 404 errors
- Fixed events endpoint deduplication

### AI Coach Enhancements
- Added schema awareness to AI Coach
- Implemented validation layer for coach responses
- Added notes CRUD operations (create, read, update, delete)
- Updated `server/api/chat/chat.js` with improved handling
- Modified `server/lib/ai/coach-dal.js` for data access

### Other Changes
- Updated `server/lib/strategy/strategy-utils.js`
- Modified `server/middleware/auth.js`
- Updated `server/agent/embed.js` and `server/agent/routes.js`
- Cleaned up npm vulnerabilities
- Removed dead code

### Files Modified
- `.claude/settings.local.json`
- `LESSONS_LEARNED.md`
- `client/src/components/CoachChat.tsx`
- `client/src/components/GlobalHeader.tsx`
- `client/src/components/auth/*` (multiple auth components)
- `client/src/contexts/auth-context.tsx`
- `client/src/contexts/location-context-clean.tsx`
- `client/src/hooks/README.md`
- `client/src/hooks/useBriefingQueries.ts`
- `client/src/pages/auth/*` (ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage)
- `client/src/pages/co-pilot/BriefingPage.tsx`
- `server/agent/*` (README, embed.js, routes.js)
- `server/middleware/*` (README, auth.js)

---

## 2026-01-05

**Commits:** `3c753ec`, `9b85443`, `c09b16b`, `db54074`, `95bd2b6`

### Codebase Audit - Health Score: 92/100

**Security Issues Fixed:**
| Issue | Severity | Resolution |
|-------|----------|------------|
| JWT_SECRET fallback mismatch (auth.js vs location.js) | HIGH | FIXED |
| `qs` npm package vulnerability | HIGH | FIXED |
| `esbuild` vulnerabilities (via drizzle-kit) | MODERATE | FIXED (npm override) |
| `resolveVenueAddressString` deprecated (no callers) | LOW | REMOVED |

**Confirmed Working Systems:**
- Venue Consolidation (venue_catalog unified)
- Highlander Session Model (one session per user)
- PostgreSQL Advisory Locks (horizontal scaling ready)
- Gemini 3 adapter upgraded (@google/genai SDK)
- Timezone-aware event filtering
- BarsTable trusts server's isOpen calculation
- Event deduplication (similar name/address/time grouping)

### Major Changes (113 files in commits)
- Updated documentation and renamed model calls
- Added 'haiku' to LEGACY_ROLE_MAP for backward compatibility
- Implemented `filterFreshEvents()` to prevent stale events in briefings
- Updated all model references to latest versions

### AI Model Updates
- Modified `server/lib/ai/llm-router-v2.js`
- Updated `server/lib/ai/model-registry.js`
- Changed `server/lib/ai/models-dictionary.js`
- Updated `server/lib/ai/adapters/gemini-2.5-pro.js`

### New Files Added
- `.serena/.gitignore` and `.serena/project.yml` (Serena MCP integration)
- `.serena/memories/` directory with memory files
- `CLAUDE-OPUS-4.5-FULL-ANALYSIS.md`
- `SAVE-IMPORTANT.md`
- `UBER_INTEGRATION_TODO.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/DATA_FLOW_MAP.json`
- `scripts/analyze-data-flow.js`
- `scripts/generate-schema-docs.js`
- `scripts/generate-schema-docs.sh`
- `scripts/resolve-venue-addresses.js`
- `client/src/types/demand-patterns.ts`
- `client/src/types/tactical-map.ts`
- `platform-data/uber/Airports/uber-us-airports-with-market.txt`
- `server/scripts/seed-uber-airports.js`
- `tools/research/flagship-models-2026-01-02.json`

### Files Deleted (Cleanup)
- `COACH_DATA_ACCESS.md`
- `ERRORS.md`
- `INTERACTIVE_REPO.md`
- `ISSUES.md`
- `NEWERRORSFOUND.md`
- `PRODISSUES.md`
- `REORGANIZATION_PLAN.md`
- `REPO_FILE_LISTING.md`

### Strategy & Briefing Changes
- Modified `server/lib/strategy/strategy-utils.js`
- Updated `server/api/briefing/briefing.js`
- Changed `client/src/components/BriefingTab.tsx`
- Modified `client/src/components/RideshareIntelTab.tsx`

---

## 2026-01-02

**Commit:** `679b306` (Published your App)

### AI & Coach Changes
- Updated `server/lib/ai/coach-dal.js`
- Modified `server/lib/ai/providers/consolidator.js`
- Changed `server/api/chat/chat.js`

### Briefing System
- Modified `server/api/briefing/briefing.js`
- Updated `server/lib/briefing/briefing-service.js`
- Changed `client/src/components/BriefingTab.tsx`

### Location & Snapshots
- Updated `client/src/contexts/location-context-clean.tsx`
- Modified `server/api/location/location.js`
- Changed `server/api/location/snapshot.js`

### Database & Schema
- Updated `shared/schema.js`
- Modified `docs/architecture/database-schema.md`

### New Scripts
- Added `server/scripts/seed-markets.js`
- Added `server/scripts/seed-uber-airports.js`
- Added `platform-data/uber/Airports/` directory

### Documentation Updates
- Modified `ARCHITECTURE.md`
- Updated `LESSONS_LEARNED.md`
- Changed `SYSTEM_MAP.md`
- Updated `UI_FILE_MAP.md`
- Modified `WORKFLOW_FILE_LISTING.md`

---

## 2026-01-01

**Commit:** `679b306` (Published your App)

### Root Documentation Overhaul
- Updated `ARCHITECTURE.md`
- Modified `SYSTEM_MAP.md`
- Changed `UI_FILE_MAP.md`
- Updated `WORKFLOW_FILE_LISTING.md`
- Modified `APICALL.md`

### Briefing Service
- Updated `server/lib/briefing/briefing-service.js`
- Modified `server/api/briefing/briefing.js`

### Markets API
- Added new markets-related endpoints
- Updated location context for market awareness

### Context Provider Changes
- Modified `client/src/contexts/location-context-clean.tsx`

---

## 2025-12-31

**Notable Changes:**

### GPS Location Fixes
- Fixed GPS location context issues
- Updated `client/src/contexts/location-context-clean.tsx`

### Authentication Pages
- Updated `client/src/pages/auth/ForgotPasswordPage.tsx`
- Modified `client/src/pages/auth/ResetPasswordPage.tsx`
- Changed `client/src/pages/auth/SignInPage.tsx`
- Updated `client/src/pages/auth/SignUpPage.tsx`

### Settings Page
- Added user settings functionality
- Updated settings-related components

---

## 2025-12-30

**Commits:** Multiple analysis sessions

### Strategy System
- Added strategy dump utility
- Modified `server/lib/strategy/strategy-utils.js`
- Updated strategy pipeline providers

### Holiday Detection
- Enhanced holiday detector logic
- Updated `server/lib/location/holiday-detector.js`

### Market Intelligence
- Added market intelligence features
- Enhanced consolidator providers

### Documentation
- Updated multiple README files
- Modified architecture docs

---

## 2025-12-29

**Multiple analysis sessions**

### Briefing Utilities
- Added briefing dump utility
- Updated `server/lib/briefing/briefing-service.js`

### Strategy Tactical Planner
- Enhanced tactical planner functionality
- Modified strategy generation logic

### Large-scale Changes
- 40-62 uncommitted file changes tracked
- Significant auth system modifications
- Component updates across client

---

## 2025-12-28

**Commits:** `fb3683f`, `b9fc00f`, `4a857af`

### Major: Authentication System Implementation
- Added `server/api/auth/auth.js`
- Created `client/src/contexts/auth-context.tsx`
- Added auth pages:
  - `client/src/pages/auth/ForgotPasswordPage.tsx`
  - `client/src/pages/auth/ResetPasswordPage.tsx`
  - `client/src/pages/auth/SignInPage.tsx`
  - `client/src/pages/auth/SignUpPage.tsx`
- Added `client/src/components/auth/` directory
- Created `client/src/types/auth.ts`
- Added `docs/architecture/authentication.md`
- Created `migrations/20251228_auth_system_tables.sql`

### Map Features
- Added bar markers on map (green=open, red=closing soon)
- Implemented multi-day event support with date range filtering
- Enhanced SmartBlocks with two-pass filtering (Grade A/B, spacing preferred)

### Briefing Fixes
- GlobalHeader shows "Resolving location..." instead of raw coords
- Briefing queries run as soon as snapshotId exists (removed pipeline phase gate)
- Smart retry for placeholder data (traffic, news, airport poll every 5s until real data)
- Added retry count limit to prevent infinite polling

### Database Schema Changes
- Modified `shared/schema.js`
- Created `migrations/20251228_drop_snapshot_user_device.sql`
- Updated `server/api/location/snapshot.js`
- Modified `server/lib/location/get-snapshot-context.js`

### Documentation
- Created `docs/memory/sessions/2025-12-28-map-features.md`
- Updated `client/src/components/README.md` for MapTab bar markers

### Files Modified
- `client/src/App.tsx`
- `client/src/routes.tsx`
- `package.json` and `package-lock.json`
- `server/api/platform/index.js`
- `server/bootstrap/routes.js`

---

## 2025-12-27

**Commit:** `b9fc00f`

### Major: Co-Pilot Router Refactor (799 files)
The co-pilot page was split into separate route-based pages:

| Route | Page Component |
|-------|----------------|
| `/co-pilot/strategy` | StrategyPage.tsx |
| `/co-pilot/bars` | BarsPage.tsx |
| `/co-pilot/briefing` | BriefingPage.tsx |
| `/co-pilot/map` | MapPage.tsx |
| `/co-pilot/intel` | IntelPage.tsx |
| `/co-pilot/about` | AboutPage.tsx |

### New Architecture
- Created `client/src/layouts/CoPilotLayout.tsx` for shared layout
- Added `client/src/contexts/co-pilot-context.tsx` for shared state
- Implemented `BottomTabNavigation` component

### Route Structure
```
/                         → Redirects to /co-pilot/strategy
/co-pilot                 → Redirects to /co-pilot/strategy
/co-pilot/strategy        → StrategyPage (AI + blocks + coach)
/co-pilot/bars            → BarsPage (venue listings)
/co-pilot/briefing        → BriefingPage (weather, traffic, news)
/co-pilot/map             → MapPage (interactive map)
/co-pilot/intel           → IntelPage (rideshare intel)
/co-pilot/about           → AboutPage (no GlobalHeader)
```

---

## 2025-12-18

**Changes tracked:**

### Authentication System Additions
- Early auth system changes
- Email alerts functionality added

### Strategy Pipeline
- Updated strategy providers
- Modified consolidator logic

---

## 2025-12-17

**Commit:** `3f44c1e` (Published your App)

### Strategy Pipeline Changes
- Modified `server/lib/strategy/strategy-utils.js`
- Updated `server/lib/ai/providers/consolidator.js`

### Component Updates
- Changed `client/src/components/SmartBlocksStatus.tsx`
- Modified `client/src/components/ui/alert.tsx`
- Updated `client/src/components/ui/toast.tsx`

### Hooks Updated
- `client/src/hooks/useEnrichmentProgress.ts`
- `client/src/hooks/useStrategyPolling.ts`
- `client/src/hooks/useVenueLoadingMessages.ts`

### Venue Logic
- Modified `server/lib/venue/enhanced-smart-blocks.js`
- Changed `server/lib/venue/event-matcher.js`

### New Files
- Added `server/lib/notifications/email-alerts.js`

### Background Jobs
- Modified `server/jobs/change-analyzer-job.js`

---

## 2025-12-16

**Multiple analysis sessions**

### Event Badge & UI
- Event badge styling changes
- Progress bar fixes

### SmartBlocks
- Enhanced SmartBlocks functionality
- Modified venue enrichment logic

### Strategy API
- Updated `server/api/strategy/blocks-fast.js`
- Changed `server/api/strategy/content-blocks.js`

---

## 2025-12-15

**Commits:** `df8ad89`, `d493581`, `00bae36`

### Change Analyzer System Created
- Added `server/jobs/change-analyzer-job.js`
- Created `server/lib/change-analyzer/file-doc-mapping.js`
- Created `docs/review-queue/README.md`
- Added `docs/review-queue/pending.md`

### AI Tools Documentation
- Added `docs/ai-tools/README.md`
- Created `docs/ai-tools/agent.md`
- Added `docs/ai-tools/assistant.md`
- Created `docs/ai-tools/eidolon.md`
- Added `docs/ai-tools/mcp.md`
- Created `docs/ai-tools/memory.md`

### SmartBlocks Event Feature
- Added event flag feature for SmartBlocks venues
- Created `server/lib/venue/event-matcher.js`

### Error Documentation
- Added `NEWERRORSFOUND.md`

### Other Changes
- Modified `gateway-server.js`
- Updated `server/api/mcp/mcp.js`
- Changed `client/src/hooks/useEnrichmentProgress.ts`
- Modified `client/src/pages/co-pilot.tsx` (before router split)
- Updated `client/src/types/co-pilot.ts`

---

## Documentation Areas Requiring Attention

Based on analysis, the following documentation files may need updates:

### High Priority
- `docs/architecture/auth-system.md` - Authentication changes
- `docs/architecture/api-reference.md` - API endpoint changes
- `docs/architecture/database-schema.md` - Schema changes
- `docs/preflight/database.md` - Database updates
- `docs/preflight/ai-models.md` - Model adapter changes
- `docs/architecture/ai-pipeline.md` - AI pipeline updates

### Medium Priority
- `docs/architecture/client-structure.md` - Component/context changes
- `docs/preflight/location.md` - Location/GPS changes
- `docs/architecture/constraints.md` - Constraint updates

### Low Priority
- `docs/architecture/server-structure.md` - Server structure changes
- Various folder README.md files

---

*This file is maintained by the change analyzer and manual review. Do not delete entries - only add new ones at the top.*
