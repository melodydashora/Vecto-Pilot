> **Last Verified:** 2026-02-17

# Subagents

Specialized AI subagents for specific tasks.

## Status

**Empty** — All subagent files have been removed as dead code (2026-02-17).

- `event-verifier.js` — DELETED. Was never integrated into the pipeline. Event validation is handled by rule-based `validateEventsHard()` in `server/lib/events/pipeline/validateEvent.js` (faster, cheaper, no LLM call needed).

## Adding New Subagents

Subagents should:
1. Have a single, focused responsibility
2. Return structured results with confidence scores
3. Handle failures gracefully
4. Log operations for debugging
5. **Be imported and called from at least one active pipeline** (avoid dead code)

## See Also

- [server/lib/ai/](../ai/) - AI adapters and providers
- [server/lib/events/](../events/) - Event discovery system
