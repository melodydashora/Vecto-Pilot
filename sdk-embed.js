import express from "express";
// Routes organized by domain in server/api/
import healthRoutes from "./server/api/health/health.js";
import blocksFastRoutes from "./server/api/strategy/blocks-fast.js";
import locationRoutes from "./server/api/location/location.js";
import actionsRoutes from "./server/api/feedback/actions.js";
import researchRoutes from "./server/api/research/research.js";
import feedbackRoutes from "./server/api/feedback/feedback.js";
import diagnosticsRoutes from "./server/api/health/diagnostics.js";
// 2026-02-17: Removed venue-events.js (duplicated by SmartBlocks event-matcher.js)
import snapshotRoutes from "./server/api/location/snapshot.js";
import jobMetricsRoutes from "./server/api/health/job-metrics.js";
import mlHealthRoutes from "./server/api/health/ml-health.js";
import chatRoutes from "./server/api/chat/chat.js";
import chatContextRoutes from "./server/api/chat/chat-context.js";
// 2026-02-17: Removed closed-venue-reasoning.js (duplicated by tactical-planner.js)
import strategyRoutes from "./server/api/strategy/strategy.js";
import diagnosticsStrategyRoutes from "./server/api/health/diagnostics-strategy.js";
import contentBlocksRoutes from "./server/api/strategy/content-blocks.js";
// Legacy processor retired — do not import
// Fast path is mounted via the gateway (server/api/strategy/blocks-fast.js)
// Logging and security handled by gateway middleware - not duplicated here
import { getThreadManager } from "./server/agent/thread-context.js";

// NOTE: Triad worker runs in strategy-generator.js (separate process)
// Removed duplicate worker import to prevent multiple polling loops

export default function createSdkRouter(opts = {}) {
  const r = express.Router();
  const threadManager = getThreadManager();

  // JSON parsing for SDK routes
  r.use(express.json({ limit: '1mb' }));

  // 2026-08-06: removed the per-request getEnhancedProjectContext +
  // storeCrossThreadMemory('recentPaths') middleware. req.extendedContext had
  // ZERO consumers (repo-wide, verified), the recentPaths store was a hard-coded
  // no-op, and the context call ran ~7 DB queries + file reads with userId=null
  // on EVERY request reaching this catch-all router — including scanner probes.
  // It was the prod source of the '[agent Enhanced Context] called with
  // userId=null — NULL-pool fallback' warning.
  r.use((req, _res, next) => {
    req.threadManager = threadManager;
    next();
  });

  // Mount all SDK routes
  r.use('/health', healthRoutes);
  r.use('/healthz', healthRoutes);
  r.use('/blocks-fast', blocksFastRoutes); // Fast tactical path (synchronous waterfall)
  r.use('/blocks', contentBlocksRoutes); // Structured content blocks (GET /blocks/strategy/:snapshotId)
  r.use('/location', locationRoutes); // All location endpoints: /api/location/resolve, /api/location/geocode, etc.
  r.use('/actions', actionsRoutes);
  r.use('/research', researchRoutes);
  r.use('/feedback', feedbackRoutes);
  r.use('/diagnostics', diagnosticsRoutes);
  // 2026-02-17: Removed venue/events route (duplicated by SmartBlocks pipeline)
  r.use('/snapshot', snapshotRoutes);
  r.use('/metrics/jobs', jobMetricsRoutes);
  r.use('/ml', mlHealthRoutes);
  r.use('/chat', chatRoutes); // AI Coach
  r.use('/chat', chatContextRoutes); // Read-only context for AI Coach
  // 2026-02-17: Removed closed-venue-reasoning route (duplicated by tactical-planner.js)
  r.use('/strategy', strategyRoutes); // Model-agnostic strategy API (minstrategy + briefing + consolidation)
  r.use('/diagnostics', diagnosticsStrategyRoutes); // Strategy pipeline test routes
  
  // Assistant override verification route
  r.get('/assistant/verify-override', (req, res) => {
    res.json({ 
      ok: true, 
      mode: process.env.APP_MODE || 'mono',
      timestamp: new Date().toISOString() 
    });
  });
  
  // Strategy routes handled by server/api/strategy/strategy.js
  // Removed stub routes that were blocking real strategy data

  r.get('/ranking', (req, res) => {
    const { snapshotId } = req.query;
    res.json({ 
      ok: true, 
      snapshotId, 
      items: [], // No hardcoded venues - use POST /api/blocks for real rankings
      timestamp: new Date().toISOString() 
    });
  });

  return r;
}
