import express from "express";
import healthRoutes from "./server/routes/health.js";
import blocksRoutes from "./server/routes/blocks.js";
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
import { loggingMiddleware } from "./server/middleware/logging.js";
import { securityMiddleware } from "./server/middleware/security.js";
import { 
  getEnhancedProjectContext,
  storeCrossThreadMemory,
  storeAgentMemory
} from "./server/agent/enhanced-context.js";
import { getThreadManager } from "./server/agent/thread-context.js";

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

      const reqKey = 'sdk.requests';
      const prev = threadManager.get(reqKey) || 0;
      const curr = prev + 1;
      threadManager.set(reqKey, curr);
      await storeAgentMemory('requestCount', curr, null, 7); // Use null for system-level data (UUID field)

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
  r.use('/blocks', blocksRoutes);
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
      items: [
        { name: 'DFW Airport Terminal D', score: 0.92, rank: 1 },
        { name: 'Downtown Dallas', score: 0.85, rank: 2 }
      ], 
      timestamp: new Date().toISOString() 
    });
  });

  return r;
}
