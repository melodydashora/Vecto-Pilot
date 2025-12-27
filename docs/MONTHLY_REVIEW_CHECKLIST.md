# Monthly Documentation Review Checklist

Use this checklist monthly to keep documentation fresh and accurate.

## Quick Check (15 minutes)

### Memory Cleanup
```javascript
// Check for pending doc updates
memory_search({ tags: ["documentation", "todo"] })

// Clear expired memories
memory_clear({ clear_expired: true })

// Review recent decisions
memory_search({ tags: ["decision"], limit: 20 })
```

### Stale Content Scan
- [ ] Are there any `doc_update_*` memories flagged?
- [ ] Were any features added without doc updates?
- [ ] Did any API endpoints change?
- [ ] Were any models or parameters updated?

## Architecture Docs Review

### Core Files
| File | Check | Last Verified |
|------|-------|---------------|
| `CLAUDE.md` | Quick-start accurate? Critical rules current? | |
| `ARCHITECTURE.md` | Folder index matches actual structure? | |
| `LESSONS_LEARNED.md` | New lessons added? Old ones still relevant? | |

### docs/architecture/
| File | Check | Last Verified |
|------|-------|---------------|
| `api-reference.md` | All endpoints listed? Params correct? | |
| `database-schema.md` | Tables match `shared/schema.js`? | |
| `ai-pipeline.md` | Model names/params current? | |
| `server-structure.md` | Folder structure accurate? | |
| `client-structure.md` | Component inventory current? | |
| `decisions.md` | Recent decisions documented? | |
| `constraints.md` | Rules still apply? | |
| `deprecated.md` | New deprecations added? | |

### docs/preflight/
| File | Check | Last Verified |
|------|-------|---------------|
| `ai-models.md` | Model params verified against code? | |
| `location.md` | GPS rules accurate? | |
| `database.md` | Query patterns current? | |
| `code-style.md` | Conventions match codebase? | |

### docs/ai-tools/
| File | Check | Last Verified |
|------|-------|---------------|
| `README.md` | Tool index complete? | |
| `mcp.md` | Tool count accurate (currently 39)? | |
| `memory.md` | Memory patterns current? | |

## Folder README Audit

Run this to find folders missing READMEs:
```bash
# Server folders
find server -type d -maxdepth 2 ! -exec test -e {}/README.md \; -print

# Client folders
find client/src -type d -maxdepth 2 ! -exec test -e {}/README.md \; -print
```

### Key Folder READMEs
- [ ] `server/api/README.md` - Routes index accurate?
- [ ] `server/lib/ai/README.md` - Adapter list current?
- [ ] `client/src/components/README.md` - Component list current?
- [ ] `client/src/hooks/README.md` - Hook inventory accurate?

## Code-Doc Sync Verification

### AI Models
```bash
# Check model dictionary
grep -n "model:" server/lib/ai/models-dictionary.js

# Verify against docs/preflight/ai-models.md
```

### Database Schema
```bash
# Check schema definition
head -100 shared/schema.js

# Verify against docs/architecture/database-schema.md
```

### API Endpoints
```bash
# List all route files
ls server/api/*/routes*.js

# Verify against docs/architecture/api-reference.md
```

## Post-Review Actions

### If Docs Need Updates
1. Make the updates immediately
2. Commit with message: `docs: monthly review update - [area]`
3. Store in memory:
```javascript
memory_store({
  key: "review_YYYY_MM",
  content: "Monthly review completed. Updated: [list]",
  tags: ["review", "documentation"],
  ttl_hours: 2160  // 90 days
})
```

### If Major Changes Found
1. Update relevant architecture doc
2. Add to `decisions.md` if architectural
3. Flag in `LESSONS_LEARNED.md` if it caused issues

## Review Schedule

| Week | Focus Area |
|------|------------|
| 1st Monday | Core docs (CLAUDE.md, ARCHITECTURE.md) |
| 2nd Monday | Architecture docs |
| 3rd Monday | Preflight cards + AI tools |
| 4th Monday | Folder READMEs |

## Completion Log

| Date | Reviewer | Issues Found | Actions Taken |
|------|----------|--------------|---------------|
| | | | |
| | | | |
| | | | |

---

*Last updated: December 2024*
