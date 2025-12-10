# Codebase Reorganization - COMPLETED

**Status:** Phase 1, Phase 2, and Phase 3 Complete (December 10, 2025)

---

## What Was Done

### Phase 1: Server Lib Reorganization (Complete)

Files moved from `server/lib/` root to organized subfolders:
- `server/lib/ai/` - AI adapters and providers
- `server/lib/strategy/` - Strategy pipeline
- `server/lib/venue/` - Venue intelligence
- `server/lib/location/` - Location services
- `server/lib/briefing/` - Briefing service
- `server/lib/external/` - Third-party integrations
- `server/lib/infrastructure/` - Logging, job queue
- `server/config/` - Configuration files

### Phase 2: Self-Documenting Structure (Complete)

Added README.md files to every folder (22 total).

### Phase 3: API Routes Domain Organization (Complete Dec 10, 2025)

**Moved `server/routes/` to `server/api/` with domain grouping:**

```
server/api/
├── auth/           # Authentication (auth.js)
├── briefing/       # Events, traffic, news (briefing.js, events.js)
├── chat/           # AI Coach, voice (chat.js, chat-context.js, realtime.js, tts.js)
├── feedback/       # User feedback (feedback.js, actions.js)
├── health/         # Health checks, diagnostics (7 files)
├── location/       # GPS, geocoding (location.js, snapshot.js)
├── research/       # Vector search (research.js, vector-search.js)
├── strategy/       # Strategy generation (blocks-fast.js, strategy.js, content-blocks.js)
├── venue/          # Venue intelligence (venue-intelligence.js, venue-events.js, closed-venue-reasoning.js)
├── utils/          # Shared utilities (http-helpers.js, safeElapsedMs.js)
└── README.md       # API overview
```

**Added 10 domain READMEs** explaining each API folder.

**Updated imports in:**
- `server/bootstrap/routes.js` - All route paths
- `sdk-embed.js` - All route imports
- `server/lib/strategy/tactical-planner.js` - utils path
- `server/lib/venue/venue-address-resolver.js` - utils path

**Removed:**
- `server/routes/` - Empty directory deleted after migration

### Phase 3b: Client Features Structure (Complete Dec 10, 2025)

**Created `client/src/features/` for feature-based organization:**

```
client/src/features/
├── README.md
└── strategy/
    └── README.md
```

**Created new hooks:**
- `client/src/hooks/useTTS.ts` - Text-to-speech hook
- `client/src/hooks/useStrategyPolling.ts` - Strategy data fetching

**Updated hooks README** with new hooks documentation.

### Cleanup

**Deleted orphaned files:**
- `client/src/hooks/useDwellTracking.ts`
- `client/src/services/locationService.ts`
- `client/src/main-simple.tsx`
- `client/src/lib/prompt/baseline.ts`

**Moved unused components to `_future/`:**
- `StrategyCoach.tsx`
- `ConsolidatedStrategyComp.tsx`

**Updated documentation:**
- `ARCHITECTURE.md` - Updated all route paths, added API domain sections
- `CLAUDE.md` - Added quick reference table

---

## Current Structure

```
server/
├── api/                    # API routes (domain-organized)
│   ├── auth/               # Authentication
│   ├── briefing/           # Events, traffic, news
│   ├── chat/               # AI Coach, voice
│   ├── feedback/           # User feedback
│   ├── health/             # Health checks
│   ├── location/           # GPS, geocoding
│   ├── research/           # Vector search
│   ├── strategy/           # Strategy generation
│   ├── venue/              # Venue intelligence
│   └── utils/              # Shared utilities
├── lib/                    # Business logic
│   ├── ai/                 # AI adapters and providers
│   ├── strategy/           # Strategy pipeline
│   ├── venue/              # Venue intelligence
│   ├── location/           # Location services
│   ├── briefing/           # Briefing service
│   ├── external/           # External APIs
│   └── infrastructure/     # Logging, queues
├── config/                 # Configuration
├── middleware/             # Request middleware
├── bootstrap/              # Server startup
└── jobs/                   # Background workers

client/src/
├── components/             # UI components
├── contexts/               # React contexts
├── hooks/                  # Custom hooks (with new TTS, StrategyPolling)
├── features/               # Feature modules
│   └── strategy/           # Strategy feature
├── pages/                  # Page components
└── utils/                  # Utility functions
```

---

## Benefits

1. **Self-documenting** - Every folder has a README explaining purpose
2. **Domain-organized** - API routes grouped by feature domain
3. **No grep needed** - READMEs show connections and data flow
4. **Easy onboarding** - New developers navigate by reading READMEs
5. **AI-friendly** - Claude understands structure from README files
6. **Clean imports** - Organized paths make dependencies clear
7. **Reusable hooks** - Complex logic extracted into custom hooks

---

## Lessons Learned

### Stale Path References
When moving files, watch for hardcoded paths in:

1. **Bootstrap files** - `server/bootstrap/*.js` may have direct path references
2. **Index files** - `index.js` and similar entry points
3. **File comments** - First-line path comments in moved files
4. **Documentation** - ARCHITECTURE.md, CLAUDE.md references

**Error example:**
```
[gateway] ❌ Health router failed: Cannot find module '/home/runner/workspace/server/routes/health.js'
```

**Fixed files in Phase 3:**
- `server/bootstrap/health.js` - Updated path to `server/api/health/health.js`
- `index.js` - Updated all 12 route imports to new `server/api/` paths
- All moved `.js` files - Updated first-line path comments

**Search command to find stale references:**
```bash
grep -r "server/routes/" --include="*.js" .
```

---

## Future Considerations

If needed, additional work could include:
- Extract more logic from `co-pilot.tsx` (1700+ LOC) into features/
- Move staged `_future/` components when ready for integration
- Add feature-level index.ts files for cleaner imports
