# Session Start Ritual

What to load at the beginning of a Claude session.

**Last Updated:** 2025-12-27

## Quick Start (CLI)

When starting work on this codebase, use the memory CLI:

```bash
# Get full context (preferences, history, DB stats)
node scripts/memory-cli.mjs context

# Get workspace statistics
node scripts/memory-cli.mjs stats

# List recent conversations
node scripts/memory-cli.mjs list 10
```

## Quick Start (API)

From code, call the `/agent/context` endpoint:

```javascript
// Load full context
const res = await fetch('/agent/context');
const { context } = await res.json();

// context includes:
// - recentSnapshots, recentStrategies, recentActions (DB)
// - agentPreferences, sessionHistory, projectState (memory)
// - conversationHistory (past conversations)
// - capabilities (what's enabled)
```

## What You'll Learn

### From Context

| Source | Contains |
|--------|----------|
| `agentPreferences` | AI models, code style, user preferences |
| `sessionHistory` | Current task, recent work |
| `projectState` | Architecture decisions, patterns |
| `conversationHistory` | Past AI Coach conversations |
| `recentSnapshots` | Recent locations, weather |
| `recentStrategies` | Recent strategy outputs |

### From Past Conversations

The AI Coach logs conversations automatically. Review them to understand:
- Recent user questions and concerns
- Patterns in strategy requests
- Frequently asked topics

## Example Session Start

```
$ node scripts/memory-cli.mjs context

=== Memory Context ===

📊 Database Stats:
   Snapshots: 10 recent
   Strategies: 5 recent
   Actions: 20 recent

🧠 Memory Stats:
   Preferences: 3 entries
   Session History: 2 entries
   Project State: 5 entries
   Conversations: 15 logged

⚙️ Capabilities:
   42/42 capabilities enabled

🔄 Self-Healing:
   Enabled: true
   Health Score: 1.0
```

## When to Skip

Skip the full ritual for:
- Quick one-liner fixes
- Documentation-only changes
- When continuing an existing session

## Key Files

| File | Purpose |
|------|---------|
| `scripts/memory-cli.mjs` | CLI for memory operations |
| `server/agent/routes.js` | API endpoints |
| `client/src/hooks/useMemory.ts` | React hook for memory |

## See Also

- [session-end.md](session-end.md) - End of session ritual
- [README.md](README.md) - Full memory documentation
