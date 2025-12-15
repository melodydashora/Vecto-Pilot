# Pre-flight Checks

Quick-reference cards for Claude to read **before** making changes. Each card is <50 lines.

## When to Use

**Before ANY edit**, identify what area the change touches and read the relevant card:

| Area | Card | Key Rules |
|------|------|-----------|
| AI/Models | [ai-models.md](ai-models.md) | Model parameters, adapter pattern |
| Location/GPS | [location.md](location.md) | GPS-first, coordinate sources |
| Database | [database.md](database.md) | snapshot_id linking, sorting |
| Code Style | [code-style.md](code-style.md) | Conventions, patterns |

## Pre-flight Workflow

```
Before ANY edit:
1. What area does this touch? (AI, database, location, UI)
2. Read the relevant preflight card
3. Grep for existing implementations
4. THEN make the change
```

## Why This Exists

These cards prevent common mistakes:
- Using wrong model parameters (GPT-5.2 400 errors)
- IP-based location fallbacks (GPS-first rule)
- Missing snapshot_id links (data integrity)
- Contradicting documented patterns

## Card Format

Each card follows this format:
- **DO**: Correct patterns with examples
- **DON'T**: Common mistakes to avoid
- **Check**: Things to verify before editing
