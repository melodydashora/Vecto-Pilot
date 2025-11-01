import express from "express";
import healthRoutes from "./server/routes/health.js";
import blocksRoutes from "./server/routes/blocks.js";
import blocksFastRoutes from "./server/routes/blocks-fast.js";
import blocksDiscoveryRoutes from "./server/routes/blocks-discovery.js";
import locationRoutes from "./server/routes/location.js";
import actionsRoutes from "./server/routes/actions.js";
import researchRoutes from "./server/routes/research.js";
import feedbackRoutes from "./server/routes/feedback.js";
import diagnosticsRoutes from "./server/routes/diagnostics.js";
import venueEventsRoutes from "./server/routes/venue-events.js";
import snapshotRoutes from "./server/routes/snapshot.js";
import jobMetricsRoutes from "./server/routes/job-metrics.js";
import mlHealthRoutes from "./server/routes/ml-health.js";
import chatRoutes from "./server/routes/chat.js";
import chatContextRoutes from "./server/routes/chat-context.js";
import closedVenueReasoningRoutes from "./server/routes/closed-venue-reasoning.js";
import strategyRoutes from "./server/routes/strategy.js";
// Legacy processor retired — do not import
// Fast path is mounted via the gateway (server/routes/blocks.js -> blocks-fast)
import { loggingMiddleware } from "./server/middleware/logging.js";
import { securityMiddleware } from "./server/middleware/security.js";
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
  r.use(loggingMiddleware);
  r.use(securityMiddleware);

  // Enhanced context middleware
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
  r.use('/blocks/fast', blocksFastRoutes); // Fast tactical path (mounted before generic blocks)
  // Async blocks retired - all blocks use fast synchronous path now
  
  // Force async blocks redirect (until client fully migrated to fast path)
  r.post('/blocks', (req, res, next) => {
    if (process.env.FORCE_ASYNC_BLOCKS === '1') {
      return res.redirect(307, '/api/blocks/async');
    }
    next();
  });
  
  r.use('/blocks', blocksRoutes); // Original synchronous POST /blocks (backward compat)
  r.use('/blocks/discovery', blocksDiscoveryRoutes);
  r.use('/location', locationRoutes);
  r.use('/resolve', locationRoutes);
  r.use('/geocode', locationRoutes);
  r.use('/timezone', locationRoutes);
  r.use('/weather', locationRoutes);
  r.use('/airquality', locationRoutes);
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
  
  // Assistant override verification route
  r.get('/assistant/verify-override', (req, res) => {
    res.json({ 
      ok: true, 
      mode: process.env.APP_MODE || 'mono',
      timestamp: new Date().toISOString() 
    });
  });
  
  // Strategy and ranking stubs (from attached doc requirements)
  r.post('/strategy', express.json(), (req, res) => {
    const { snapshotId } = req.query;
    res.json({ ok: true, snapshotId, strategy: 'Generated via MONO mode', timestamp: new Date().toISOString() });
  });

  r.get('/strategy/:snapshotId', (req, res) => {
    const { snapshotId } = req.params;
    res.json({ ok: true, snapshotId, strategy: 'Retrieved via MONO mode', timestamp: new Date().toISOString() });
  });

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
