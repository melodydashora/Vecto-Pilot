// server/events/phase-emitter.js
//
// Dedicated module for phase change events during pipeline execution.
// Extracted from server/api/briefing/events.js to eliminate legacy SSE router dependency.
//
// 2026-01-09: Created as part of SSE consolidation.
// Phase events are high-frequency ephemeral updates (not persisted to DB).
// Used by: strategy-events.js (/events/phase SSE endpoint)
//          strategy-utils.js (updatePhase emits here)
//          blocks-fast.js (passes to updatePhase)

import { EventEmitter } from 'events';

// Phase change emitter for real-time pipeline progress
// Emits: 'change' with { snapshot_id, phase, phase_started_at, expected_duration_ms }
export const phaseEmitter = new EventEmitter();

// Prevent warnings with many concurrent SSE connections
phaseEmitter.setMaxListeners(100);
