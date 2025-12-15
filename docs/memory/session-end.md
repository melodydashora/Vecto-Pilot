# Session End Ritual

What to save at the end of a Claude session.

## Quick End

Before ending a session, persist important learnings:

```javascript
// 1. Store session learnings
memory_store({
  key: `session_${YYYY_MM_DD}_learnings`,
  content: "Summary of what was learned, fixed, or discovered",
  tags: ["session", "learning"],
  ttl_hours: 720  // 30 days
})

// 2. Update any changed decisions
memory_store({
  key: "decision_xyz",
  content: "Updated decision content",
  tags: ["decision", "updated"],
  metadata: { updated_on: "2024-12-15", reason: "..." }
})

// 3. Flag documentation needing updates
memory_store({
  key: `doc_update_${YYYY_MM_DD}`,
  content: "List of docs that need updating",
  tags: ["documentation", "todo"],
  ttl_hours: 168  // 1 week
})
```

## What to Store

### Always Store

- **Bugs fixed**: Root cause and solution
- **New patterns discovered**: Code patterns that worked
- **User preferences learned**: Communication style, commit format
- **Things that broke**: What failed and why

### Store If Changed

- **Architecture decisions**: If something was decided differently
- **Model parameters**: If correct params were discovered
- **API behaviors**: New API quirks discovered

### Flag for Later

- **Documentation updates**: Docs that need changing
- **Refactoring opportunities**: Code that should be cleaned up
- **Feature ideas**: User-requested features

## Example Session End

```javascript
// Session learnings
memory_store({
  key: "session_2024_12_15_learnings",
  content: `
    1. Fixed: BarsTable was showing wrong isOpen for venues in other timezones
       - Solution: Server calculates with venue timezone, client trusts server
    2. Discovered: Routes API needs departureTime 30s in future
    3. User prefers: Detailed commit messages with bullet points
    4. Warning: Don't use temperature param with GPT-5.2
  `,
  tags: ["session", "learning", "december"],
  ttl_hours: 720
})

// Decision update
memory_store({
  key: "decision_venue_isopen",
  content: "Server calculates isOpen using venue's timezone via Intl.DateTimeFormat. Client trusts server value. Client-side recalculation removed due to timezone bugs.",
  tags: ["decision", "venue", "client"],
  metadata: { decided_on: "2024-12-15" }
})

// Documentation flag
memory_store({
  key: "doc_update_2024_12_15",
  content: "Update client-structure.md to document BarsTable isOpen behavior",
  tags: ["documentation", "todo"],
  ttl_hours: 168
})
```

## When to Skip

Skip for:
- Sessions with no significant work
- Pure research/reading sessions
- Already documented work

## Cleanup

Periodically clear expired memories:

```javascript
memory_clear({ clear_expired: true })
```

## See Also

- [session-start.md](session-start.md) - Start of session ritual
- [README.md](README.md) - Full memory documentation
