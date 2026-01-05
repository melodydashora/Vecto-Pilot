# Reviewed Queue (`docs/reviewed-queue/`)

## Purpose

Archive of completed review items and consolidated learnings from the review process.

**Key Principle:** Completed work should be converted into actionable rules, not just archived.

## Files

| File | Purpose |
|------|---------|
| `RULES_FROM_COMPLETED_WORK.md` | **Primary Output** - Actionable patterns extracted from completed implementations |
| `YYYY-MM-DD-summary.md` | Daily summaries of completed work (for historical reference) |

## Workflow

### When Work is Completed

1. **Extract Rules** - Add actionable patterns to `RULES_FROM_COMPLETED_WORK.md`
2. **Create Summary** - Optionally create a dated summary file
3. **Clean pending.md** - Remove completed items from `docs/review-queue/pending.md`

### What Makes a Good Rule

Rules should be:
- **Actionable** - Developer can follow it immediately
- **Specific** - Includes code examples
- **Contextualized** - Explains when to apply

```markdown
### Rule: Use Dedicated Lookup Tables for O(1) Access

**Source:** US Market Cities Implementation (2026-01-05)
**Problem:** JSONB arrays require full scans
**Solution:** Create dedicated mapping tables

[Code example]

**When to Apply:** Any time you need value→data lookup
```

## Connection to review-queue/

```
docs/review-queue/pending.md
    │
    │ (completed items)
    ↓
docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md  ← Extract patterns
docs/reviewed-queue/YYYY-MM-DD-summary.md         ← Archive details
```

## Related

- `docs/review-queue/` - Source of items to review
- `LESSONS_LEARNED.md` - Bug fixes and gotchas (different from rules)
- `CLAUDE.md` - Project rules (may incorporate reviewed-queue rules)
