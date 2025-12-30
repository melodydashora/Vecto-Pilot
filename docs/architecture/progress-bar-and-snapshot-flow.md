# Progress Bar & Snapshot Flow Architecture

**Created:** December 30, 2025
**Purpose:** Document the intended architecture for snapshot creation and progress bar tracking to prevent future regressions.

---

## 1. Snapshot Flow (TO BE HARDENED)

### Current Issue: Duplicate Snapshots

Two snapshots are being created simultaneously because:
1. One snapshot is cached in memory for speed
2. One snapshot lands in the database
3. This causes race conditions and duplicate pipeline runs

### Intended Flow (Single Source of Truth)

```
┌─────────────────────────────────────────────────────────────────┐
│                         GPS RECEIVED                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              CREATE ONE SNAPSHOT IN DATABASE                     │
│              (snapshots table - single insert)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              TRIGGER PIPELINE (POST /api/blocks-fast)            │
│              Pass only snapshot_id, not memory data              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              PIPELINE WRITES TO TABLES                           │
│              - strategies table (phase, strategy_for_now)        │
│              - briefings table (events, traffic, news)           │
│              - rankings table (venue blocks)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND FETCHES FROM DATABASE                      │
│              Wait for briefing != null, then fetch rows          │
│              NO memory caching - DB is source of truth           │
└─────────────────────────────────────────────────────────────────┘
```

### Why Memory Caching Will Be Removed

- Currently used for speed during anonymous sessions
- Once users sign up, we have persistent user_id linking
- Database becomes the single source of truth
- Eliminates race conditions and duplicate snapshots

### Files Involved

| File | Current Role | Intended Change |
|------|--------------|-----------------|
| `client/src/contexts/location-context-clean.tsx` | Creates snapshot, caches in sessionStorage | Create snapshot ONLY in DB, remove memory caching |
| `client/src/contexts/co-pilot-context.tsx` | Triggers pipeline, restores from localStorage | Fetch from DB only, no localStorage restore |
| `server/api/location/index.js` | Creates snapshot row | Should be the ONLY place snapshots are created |
| `server/api/strategy/blocks-fast.js` | Runs pipeline | Should read from DB, not receive memory data |

---

## 2. Progress Bar Architecture (REAL-TIME SSE)

### Intended Design: SSE for Real-Time Updates

The progress bar SHOULD show real-time phase updates via SSE. Previous implementations had issues that weren't documented, leading to reverts.

### Backend Phase Updates

```javascript
// server/lib/strategy/strategy-utils.js
export async function updatePhase(snapshotId, phase, options = {}) {
  // 1. Update phase in strategies table
  await db.update(strategies).set({
    phase,
    phase_started_at: new Date()
  }).where(eq(strategies.snapshot_id, snapshotId));

  // 2. Emit SSE event if emitter provided
  if (options.phaseEmitter) {
    options.phaseEmitter.emit('change', {
      snapshot_id: snapshotId,
      phase,
      phase_started_at: now.toISOString(),
      expected_duration_ms: PHASE_EXPECTED_DURATIONS[phase]
    });
  }
}
```

### SSE Endpoint

```javascript
// server/api/briefing/events.js
// GET /events/phase - Real-time phase updates
router.get('/phase', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');

  phaseEmitter.on('change', (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
});
```

### Frontend SSE Subscription

```typescript
// client/src/utils/co-pilot-helpers.ts
export function subscribePhaseChange(callback): () => void {
  const eventSource = new EventSource('/events/phase');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    callback(data); // { snapshot_id, phase, phase_started_at, expected_duration_ms }
  };

  return () => eventSource.close();
}

// client/src/contexts/co-pilot-context.tsx
useEffect(() => {
  const unsubscribe = subscribePhaseChange((data) => {
    if (data.snapshot_id === lastSnapshotId) {
      queryClient.invalidateQueries({ queryKey: ['/api/blocks/strategy', lastSnapshotId] });
    }
  });
  return unsubscribe;
}, [lastSnapshotId]);
```

### Pipeline Phases (9 total)

| Phase | Description | Expected Duration | Emitted By |
|-------|-------------|-------------------|------------|
| `starting` | Strategy row creation | 500ms | blocks-fast.js |
| `resolving` | Location resolution | 2000ms | blocks-fast.js |
| `analyzing` | Briefing (Gemini + traffic) | 25000ms | blocks-fast.js |
| `immediate` | GPT-5.2 immediate strategy | 8000ms | blocks-fast.js |
| `venues` | GPT-5.2 tactical planner | 90000ms | enhanced-smart-blocks.js |
| `routing` | Google Routes API | 2000ms | enhanced-smart-blocks.js |
| `places` | Event matching + Places | 2000ms | enhanced-smart-blocks.js |
| `verifying` | Event verification | 1000ms | enhanced-smart-blocks.js |
| `complete` | Done | 0ms | blocks-fast.js |

### Progress Calculation

```typescript
// client/src/hooks/useEnrichmentProgress.ts
function calculateDynamicProgress(currentPhase, phaseElapsedMs, expectedDurations) {
  // 1. Sum duration of completed phases
  let completedDuration = 0;
  for (phases before currentPhase) {
    completedDuration += durations[phase];
  }

  // 2. Add progress within current phase (capped at 95%)
  const phaseProgress = Math.min(0.95, phaseElapsedMs / currentPhaseDuration);
  const currentContribution = currentPhaseDuration * phaseProgress;

  // 3. Calculate total percentage
  return (completedDuration + currentContribution) / totalDuration * 100;
}
```

---

## 3. Known Issues & History

### SSE Was Reverted (Nov 25, 2025)

**Commit `83cacf2`:** "Remove SSE for smart blocks and implement polling"
- Reason: "SSE timeouts and race conditions"
- **Root cause was NOT documented**
- SSE approach is correct, implementation had bugs

### Progress Bar Fixes (Dec 16, 2025)

**Commit `63a904a`:** Fixed progress jumping 63% → 100%
- Cause: `venues` phase was allocated 4000ms but took 25000ms
- Fix: Updated expected durations to match reality

**Commit `0980953`:** Fixed progress stalling at 95%
- Cause: Phases taking longer than expected
- Fix: Overestimate durations slightly

---

## 4. Hardening Checklist

### Phase 1: Snapshot Flow
- [ ] Identify all places snapshots are created
- [ ] Consolidate to single creation point (server/api/location)
- [ ] Remove memory caching in location-context-clean.tsx
- [ ] Remove sessionStorage persistence (or reduce TTL significantly)
- [ ] Ensure frontend waits for DB data, not memory data

### Phase 2: Progress Bar SSE
- [ ] Verify SSE endpoint `/events/phase` works correctly
- [ ] Test SSE subscription in co-pilot-context.tsx
- [ ] Ensure query invalidation triggers on phase_change
- [ ] Verify progress bar updates in real-time
- [ ] Document any edge cases (reconnection, timeouts)

### Phase 3: Database as Source of Truth
- [ ] Frontend fetches strategy from `/api/blocks/strategy/:snapshotId`
- [ ] Frontend fetches blocks from `/api/blocks-fast?snapshotId=X`
- [ ] No data passed from memory between components
- [ ] All data flows through DB tables

---

## 5. Files Modified Today (Dec 30, 2025)

| File | Change | Status |
|------|--------|--------|
| `client/src/contexts/co-pilot-context.tsx` | Added `enrichmentPhase` to context, added SSE subscription | Keep |
| `client/src/contexts/co-pilot-context.tsx` | Removed localStorage restore | Keep (correct) |
| `client/src/contexts/location-context-clean.tsx` | Reduced TTL 1hr → 2min | Review - may be too short |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Use `enrichmentPhase` from context | Keep |
| `client/src/utils/co-pilot-helpers.ts` | Added `subscribePhaseChange()` | Keep |
| `LESSONS_LEARNED.md` | Added sections 15 & 16 | Keep (documentation) |

---

## 6. Git Commits Reference

| Commit | Date | Description | Relevance |
|--------|------|-------------|-----------|
| `b5296f6` | Nov 4 | "Use SSE instead of polling" | First SSE attempt |
| `83cacf2` | Nov 25 | "Remove SSE, use polling" | Reverted due to undocumented issues |
| `5349d15` | Dec | "Add dynamic time-based progress" | Current progress system |
| `63a904a` | Dec 16 | "Fix progress bar jumping" | Duration fixes |
| `0980953` | Dec 16 | "Increase durations" | Prevent stalling |
| `46de303` | Dec 15 | "Granular SmartBlocks phases" | Added venues→routing→places→verifying |

---

**Next Steps:**
1. Test current SSE implementation
2. Identify duplicate snapshot creation points
3. Implement single-snapshot flow
4. Document each change before committing
