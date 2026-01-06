> **Last Verified:** 2026-01-06

# TRIAD Pipeline Tests (`tests/triad/`)

## Purpose

Tests for the TRIAD AI pipeline (Claude → Gemini → GPT).

## Files

| File | Purpose |
|------|---------|
| `test-pipeline.js` | End-to-end pipeline execution tests |

## Running

```bash
node tests/triad/test-pipeline.js
```

## What's Tested

- Minstrategy generation (Claude)
- Briefer output (Gemini)
- Consolidator output (Gemini/GPT)
- Venue planner (GPT)
- Full pipeline timing
