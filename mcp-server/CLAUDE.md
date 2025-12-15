# Claude Desktop Guidelines for Vecto Pilot

**IMPORTANT: Read this before making any changes to the codebase.**

## This Codebase Can Break Easily

Vecto Pilot is a complex multi-model AI pipeline with many interconnected parts. Changes in one area can cause cascading failures elsewhere.

### Before Making Changes

1. **Use the tools to understand first** - Don't guess. Use `read_file`, `grep_search`, and `search_symbols` to understand how things work.

2. **Check existing patterns** - Use `code_map` and `get_repo_info` to understand the project structure.

3. **Read the documentation** - Key files:
   - `/CLAUDE.md` - Project overview and critical rules
   - `/ARCHITECTURE.md` - System architecture
   - `/LESSONS_LEARNED.md` - Past mistakes to avoid
   - `/docs/architecture/*.md` - Detailed documentation

4. **Search before creating** - Use `grep_search` to find existing implementations before writing new code.

## Critical Rules (Will Break Things If Ignored)

### Model Parameters
```javascript
// GPT-5.2 - CORRECT
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }

// GPT-5.2 - WRONG (causes 400 errors)
{ reasoning: { effort: "medium" } }  // Nested format breaks
{ temperature: 0.7 }                  // Not supported
```

### Location Data
- **GPS-first**: Never use IP fallback or default locations
- **Coordinates from Google APIs only**: Never trust AI-generated lat/lng
- AI models hallucinate coordinates - always verify with Google Geocoding

### Database Links
- All data must link to `snapshot_id`
- Use `created_at DESC` for sorting (newest first)

### File Conventions
- Unused variables: prefix with `_`
- Every folder has a README.md explaining its purpose
- Check LESSONS_LEARNED.md before major changes

## How to Use These Tools Safely

### Understand Before Changing
```
1. read_file → Read the file you want to change
2. grep_search → Find all usages of functions you'll modify
3. search_symbols → Find where things are defined
4. ai_analyze → Check for potential issues
```

### Validate Changes
```
1. Make small, focused changes
2. Use run_command to run tests: npm run typecheck
3. Check for regressions with grep_search
```

### When Unsure
- Use `ai_explain` to understand code structure
- Use `get_repo_info` for project overview
- Use `memory_store` to save important findings for later
- **Ask the user** if something is unclear

## Common Pitfalls

| Pitfall | How to Avoid |
|---------|--------------|
| Breaking API contracts | Check all callers with `grep_search` before changing function signatures |
| Duplicate code | Use `grep_search` to find existing implementations |
| Wrong model parameters | Check `/docs/architecture/ai-pipeline.md` for correct formats |
| Missing error handling | Use `ai_analyze` with `type: "error_handling"` |
| Stale venue data | Client recalculates `isOpen` - don't rely on cached server values |

## Project-Specific Warnings

### AI Pipeline (TRIAD)
The AI pipeline runs in phases. Changing phase order or timing breaks everything:
```
Phase 1: Strategist + Briefer + Holiday (parallel)
Phase 2: Daily + Immediate Consolidator (parallel)
Phase 3: Venue Planner + Enrichment
Phase 4: Event Validator
```

### Event Discovery
- Events need lat/lng coordinates to show on map
- Use Google Geocoding API for coordinates, not AI
- `discovered_events` table uses MD5 hash for deduplication

### Location Context
- `location-context-clean.tsx` is the single source of truth for weather
- Never create duplicate location providers

## Remember

1. **Understand first, change second** - Use the tools to explore
2. **Small changes** - Make incremental changes, not big rewrites
3. **Test always** - Run `npm run typecheck` after changes
4. **Ask when unsure** - Better to ask than to break
5. **Document findings** - Use `memory_store` to save important discoveries

This codebase has been carefully architected. Respect the patterns that exist.
