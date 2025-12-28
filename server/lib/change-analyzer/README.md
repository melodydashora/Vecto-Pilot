# Change Analyzer

Automated documentation maintenance system.

## Purpose

Analyzes code changes and maps them to potentially affected documentation.

## Files

| File | Purpose |
|------|---------|
| `file-doc-mapping.js` | Maps source files to documentation files |

## How It Works

1. **On server start**: Analyzer runs automatically
2. **Git analysis**: Detects modified, added, deleted files
3. **Doc mapping**: Maps changes to affected documentation
4. **Output**: Appends findings to `docs/review-queue/`

## File-to-Doc Mapping Rules

```javascript
// Example mappings
'server/api/**' → 'api-reference.md'
'server/lib/ai/**' → 'ai-models.md', 'ai-pipeline.md'
'shared/schema.js' → 'database-schema.md'
```

## Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `RUN_CHANGE_ANALYZER` | `true` | Enable/disable on startup |
| `CHANGE_ANALYZER_COMMITS` | `5` | Commits to analyze |

## See Also

- [docs/review-queue/](../../../docs/review-queue/) - Analysis output
