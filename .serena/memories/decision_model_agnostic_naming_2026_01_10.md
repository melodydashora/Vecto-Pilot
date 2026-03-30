# Decision: Model-Agnostic Function Naming

**Date:** January 10, 2026
**Status:** Implemented
**Tags:** architecture, naming, models

## Context

The codebase had model-specific function names like `searchWithGemini3Pro` and `searchWithGemini25Pro`. This violated the model-agnostic architecture principle.

## Decision

Function names should be **capability-based**, not model-specific:

```javascript
// WRONG - Model-specific name
async function searchWithGemini3Pro(...) { ... }

// CORRECT - Capability-based name
async function searchWithGoogleSearch(...) { ... }
```

## Changes Made

1. **Renamed** `searchWithGemini3Pro` → `searchWithGoogleSearch` in `server/scripts/sync-events.mjs`
2. **Removed** redundant `searchWithGemini25Pro` (was duplicate with wrong model)
3. **Updated** source_model to `'Google-Search'` (capability-based)
4. **Updated** exports and call sites

## Rationale

1. **Model-agnostic codebase** - The underlying model can change without renaming functions
2. **Capability focus** - The `google_search` tool is the key feature, not the model brand
3. **Env-driven configuration** - Models should be configurable via environment variables
4. **No redundancy** - One function per capability, not one per model version

## Model ID Reference

From project memory (`bug_gemini_model_ids_and_tokens_2026_01_02`):
- Gemini 3 model IDs require `-preview` suffix
- Correct: `gemini-3-pro-preview`
- Wrong: `gemini-3-pro` (404 error)

## Related Files

- `server/scripts/sync-events.mjs` - Event discovery functions
- `server/lib/briefing/briefing-service.js` - Briefing generation
- `docs/review-queue/2026-01-09.md` - Change documentation
