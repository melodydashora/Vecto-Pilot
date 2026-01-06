> **Last Verified:** 2026-01-06

# Review Queue

Automated change analysis for documentation maintenance. This folder contains findings from the Change Analyzer that runs on server startup.

## How It Works

1. **Server starts** → Change Analyzer runs automatically
2. **Git analysis** → Detects modified, added, deleted files
3. **Doc mapping** → Maps changed files to potentially affected docs
4. **Output** → Appends findings to daily log and pending.md

## Files

| File | Purpose |
|------|---------|
| `pending.md` | Current items needing review |
| `YYYY-MM-DD.md` | Daily analysis logs (historical record) |
| `ai-coach-enhancements.md` | AI Coach enhancement tasks |
| `IN_PROGRESS_WORKSTREAM.md` | Current in-progress work items |
| `../reviewed-queue/` | **Completed work** - rules extracted, summaries archived |

## Validation Workflow

### For Human Review

1. Check `pending.md` for flagged items
2. Review each "Potentially Affected Doc"
3. Decide: Does the doc need updating?
4. If yes → Update the doc
5. If no → Mark as "reviewed, no change needed"
6. **Extract rules** to `../reviewed-queue/RULES_FROM_COMPLETED_WORK.md`
7. **Delete** completed items from `pending.md`

### Completion Workflow (2026-01-05)

When work is completed:

```
pending.md (completed items)
    │
    ├──► ../reviewed-queue/RULES_FROM_COMPLETED_WORK.md  (extract actionable patterns)
    │
    ├──► ../reviewed-queue/YYYY-MM-DD-summary.md         (archive details)
    │
    └──► DELETE from pending.md                           (keep it clean)
```

**Key Principle:** Don't just archive completed work—extract actionable rules from it.

### For Claude Review

When starting a session, check for pending items:

```javascript
// Read pending review items
Read({ file_path: "docs/review-queue/pending.md" })

// After reviewing, update status
Edit({
  file_path: "docs/review-queue/pending.md",
  old_string: "### Status: PENDING",
  new_string: "### Status: REVIEWED - No doc changes needed"
})
```

## Priority Levels

| Priority | Meaning |
|----------|---------|
| **High** | Core docs likely need update (schema, API, pipeline) |
| **Medium** | Folder READMEs may need update |
| **Low** | Consider adding new docs |

## File-to-Doc Mapping

The analyzer uses these rules to map changed files to docs:

| File Pattern | Documentation |
|--------------|---------------|
| `server/api/**` | api-reference.md, folder README |
| `server/lib/ai/**` | ai-models.md, ai-pipeline.md |
| `shared/schema.js` | database-schema.md |
| `client/src/components/**` | client-structure.md |
| `server/lib/strategy/**` | strategy-framework.md |

See `server/lib/change-analyzer/file-doc-mapping.js` for full mapping.

## Manual Trigger

To run analysis manually:

```bash
# Via MCP tool
analyze_changes

# Or restart the server
npm run dev
```

## Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `RUN_CHANGE_ANALYZER` | `true` | Enable/disable on startup |
| `CHANGE_ANALYZER_COMMITS` | `5` | Commits to analyze |

## Example Output

```markdown
## 2024-12-15 Analysis

### Files Changed
- `server/api/strategy/routes.js` - Modified (+20, -5)

### Potentially Affected Docs
- [ ] `docs/architecture/api-reference.md` - Strategy routes changed

### Status: PENDING
```

## Maintenance

- Daily logs older than 30 days can be archived/deleted
- `pending.md` should be reviewed weekly
- `resolved.md` can be cleared monthly

## See Also

- [../reviewed-queue/](../reviewed-queue/) - Completed work with extracted rules
- [../reviewed-queue/RULES_FROM_COMPLETED_WORK.md](../reviewed-queue/RULES_FROM_COMPLETED_WORK.md) - Actionable patterns
- [MONTHLY_REVIEW_CHECKLIST.md](../MONTHLY_REVIEW_CHECKLIST.md) - Full review process
- [CLAUDE.md](../../CLAUDE.md) - Project guidelines
