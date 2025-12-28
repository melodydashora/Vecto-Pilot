# Session End Ritual

What to save at the end of a Claude session.

**Last Updated:** 2025-12-27

## Quick End (CLI)

Before ending a session, persist important learnings:

```bash
# Log what was accomplished
node scripts/memory-cli.mjs log "Session Topic" "Summary of what was done"

# Store a decision for future sessions
node scripts/memory-cli.mjs pref "decision_xyz" '{"content":"Decision details","reason":"Why"}'

# Store current task state (auto-expires in 7 days)
node scripts/memory-cli.mjs session "current_task" '{"task":"Feature X","status":"in_progress"}'

# Store project learning (auto-expires in 30 days)
node scripts/memory-cli.mjs project "pattern_xyz" "Discovered pattern for handling..."
```

## Quick End (API)

From code, use the memory endpoints:

```javascript
// Log conversation summary
await fetch('/agent/memory/conversation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic: 'React Router Refactor',
    summary: 'Completed migration from monolithic co-pilot.tsx to route-based pages',
    userId: 'system'
  })
});

// Store a preference (365 day TTL)
await fetch('/agent/memory/preference', {
  method: 'POST',
  body: JSON.stringify({
    key: 'commit_style',
    value: { format: 'conventional', emoji: false },
    userId: 'system'
  })
});

// Store session state (7 day TTL)
await fetch('/agent/memory/session', {
  method: 'POST',
  body: JSON.stringify({
    key: 'wip_feature',
    data: { branch: 'feature/xyz', status: 'testing' },
    userId: 'system'
  })
});
```

## What to Store

### Always Store (via `log` command)

| What | Example |
|------|---------|
| Bugs fixed | "Fixed timezone calculation in BarsTable" |
| New patterns | "Discovered pattern for SSE progress tracking" |
| User preferences | "User prefers detailed commit messages" |
| Things that broke | "GPT-5.2 400 error with nested params" |

### Store If Changed (via `pref` command)

| What | TTL |
|------|-----|
| Architecture decisions | 365 days |
| Model parameters | 365 days |
| API behaviors | 365 days |

### Flag for Later (via `project` command)

| What | TTL |
|------|-----|
| Documentation updates | 30 days |
| Refactoring opportunities | 30 days |
| Feature ideas | 30 days |

## Example Session End

```bash
# Log the session summary
node scripts/memory-cli.mjs log \
  "Router Refactor Complete" \
  "Migrated co-pilot.tsx to 7 route-based pages. Added CoPilotLayout, co-pilot-context. Updated all docs."

# Store a decision discovered
node scripts/memory-cli.mjs pref \
  "decision_router" \
  '{"pattern":"route-based","reason":"Better code splitting and maintainability"}'

# Note pending work
node scripts/memory-cli.mjs session \
  "next_session" \
  '{"todo":"Test memory integration with AI Coach","priority":"high"}'
```

## AI Coach Auto-Logging

The AI Coach (`client/src/components/CoachChat.tsx`) now **automatically logs conversations** to memory after each exchange. This happens via the `useMemory` hook.

No manual action needed for Coach conversations - they're persisted automatically.

## When to Skip

Skip for:
- Sessions with no significant work
- Pure research/reading sessions
- Already documented work

## Memory Cleanup

Expired memories are automatically excluded from queries. To compact the database:

```javascript
// Server-side only
import { memoryCompact } from '../eidolon/memory/pg.js';
await memoryCompact({ table: 'agent_memory' });
```

## See Also

- [session-start.md](session-start.md) - Start of session ritual
- [README.md](README.md) - Full memory documentation
