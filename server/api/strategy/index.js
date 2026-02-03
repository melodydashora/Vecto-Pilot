// server/api/strategy/index.js - Barrel exports for strategy routes
// Strategy endpoints: TRIAD pipeline, blocks, SSE events, tactical plan

export { default as strategyRouter } from './strategy.js';
export { default as blocksFastRouter } from './blocks-fast.js';
export { default as contentBlocksRouter } from './content-blocks.js';
export { default as strategyEventsRouter } from './strategy-events.js';
export { default as tacticalPlanRouter } from './tactical-plan.js';

// Route summary:
// POST /api/blocks-fast - Trigger TRIAD pipeline (strategy + venues)
// GET  /api/blocks-fast - Get existing blocks for snapshot
// GET  /api/blocks/strategy/:snapshotId - Get strategy content with timing
// GET  /api/strategy/:snapshotId - Get strategy status
// GET  /api/strategy/events - SSE for strategy progress
// POST /api/strategy/tactical-plan - AI tactical analysis for missions
