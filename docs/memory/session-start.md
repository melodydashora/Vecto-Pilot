# Session Start Ritual

What to load at the beginning of a Claude session.

## Quick Start

When starting work on this codebase, load context from memory:

```javascript
// 1. Load architecture decisions
memory_search({ tags: ["decision"], limit: 20 })

// 2. Load recent learnings (last 5 sessions)
memory_search({ tags: ["learning"], limit: 5 })

// 3. Load user preferences
memory_retrieve({ key: "user_preferences" })

// 4. Check for pending documentation updates
memory_search({ tags: ["documentation", "todo"], limit: 10 })
```

## What You'll Learn

### From Decisions

- Which AI models to use and their correct parameters
- Location/GPS rules
- Database conventions
- Code style preferences

### From Recent Learnings

- Bugs fixed in past sessions
- Patterns discovered
- User feedback received
- Things that broke and why

### From User Preferences

- Commit message style
- Documentation preferences
- Testing expectations
- Communication style

## Example Session Start

```
Claude Session Start - December 15, 2024

Loading context from memory...

Decisions loaded (5):
- decision_ai_models: Use callModel() adapter...
- decision_location: GPS-first, no IP fallback...
- decision_database: All data links to snapshot_id...
- decision_logging: Use workflow logger, not console.log...
- decision_testing: Run typecheck before commits...

Recent learnings (3):
- session_2024_12_14: Fixed BarsTable isOpen calculation...
- session_2024_12_13: Routes API requires future timestamp...
- session_2024_12_12: User prefers detailed commits...

Context loaded. Ready to work.
```

## When to Skip

Skip the full ritual for:
- Quick one-liner fixes
- Documentation-only changes
- When continuing an existing session

## See Also

- [session-end.md](session-end.md) - End of session ritual
- [README.md](README.md) - Full memory documentation
