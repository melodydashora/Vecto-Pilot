import express from "express";
// Routes organized by domain in server/api/
import healthRoutes from "./server/api/health/health.js";
import blocksFastRoutes from "./server/api/strategy/blocks-fast.js";
import locationRoutes from "./server/api/location/location.js";
import actionsRoutes from "./server/api/feedback/actions.js";
import researchRoutes from "./server/api/research/research.js";
import feedbackRoutes from "./server/api/feedback/feedback.js";
import diagnosticsRoutes from "./server/api/health/diagnostics.js";
import venueEventsRoutes from "./server/api/venue/venue-events.js";
import snapshotRoutes from "./server/api/location/snapshot.js";
import jobMetricsRoutes from "./server/api/health/job-metrics.js";
import mlHealthRoutes from "./server/api/health/ml-health.js";
import chatRoutes from "./server/api/chat/chat.js";
import chatContextRoutes from "./server/api/chat/chat-context.js";
import closedVenueReasoningRoutes from "./server/api/venue/closed-venue-reasoning.js";
import strategyRoutes from "./server/api/strategy/strategy.js";
import diagnosticsStrategyRoutes from "./server/api/health/diagnostics-strategy.js";
import contentBlocksRoutes from "./server/api/strategy/content-blocks.js";
// Legacy processor retired — do not import
// Fast path is mounted via the gateway (server/api/strategy/blocks-fast.js)
// Logging and security handled by gateway middleware - not duplicated here
import { 
  getEnhancedProjectContext,
  storeCrossThreadMemory,
  storeAgentMemory
} from "./server/agent/enhanced-context.js";
import { getThreadManager } from "./server/agent/thread-context.js";

// NOTE: Triad worker runs in strategy-generator.js (separate process)
// Removed duplicate worker import to prevent multiple polling loops

export default function createSdkRouter(opts = {}) {
  const r = express.Router();
  const threadManager = getThreadManager();

  // JSON parsing for SDK routes
  r.use(express.json({ limit: '1mb' }));

  // Enhanced context middleware (logging/security handled by gateway)
  r.use(async (req, res, next) => {
    try {
      const ctx = await getEnhancedProjectContext({
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        includeThreadContext: true
      });

      await storeCrossThreadMemory('recentPaths', { 
        path: req.originalUrl, 
        method: req.method,
        t: Date.now(),
        ip: req.ip
      }, null, 7); // Use null for system-level data (UUID field)

      req.extendedContext = ctx;
      req.threadManager = threadManager;
      
      next();
    } catch (err) {
      console.error('[SDK embed] Context enrichment failed:', err.message);
      req.extendedContext = { error: err.message };
      next();
    }
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
  r.use('/venue/events', venueEventsRoutes);
  r.use('/snapshot', snapshotRoutes);
  r.use('/metrics/jobs', jobMetricsRoutes);
  r.use('/ml', mlHealthRoutes);
  r.use('/chat', chatRoutes); // AI Strategy Coach
  r.use('/chat', chatContextRoutes); // Read-only context for AI Coach (no external API calls)
  r.use('/closed-venue-reasoning', closedVenueReasoningRoutes); // Closed venue reasoning (GPT-5)
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
