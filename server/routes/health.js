import { Router } from 'express';
import { routerDiagnosticsV2 } from '../lib/llm-router-v2.js';
import { getPoolStats, getSharedPool } from '../db/pool.js';
import { getAgentState } from '../db/connection-manager.js';
import { providers } from '../lib/strategies/index.js';
import { ndjson } from '../logger/ndjson.js';

const router = Router();

router.get('/', (req, res) => {
  const diag = routerDiagnosticsV2();
  const poolStats = getPoolStats();
  res.json({
    ok: true,
    service: 'Vecto Co-Pilot API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pool: poolStats,
    pid: process.pid,
    llm: diag
  });
});

// PostgreSQL pool statistics endpoint
router.get('/pool-stats', (req, res) => {
  const stats = getPoolStats();
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    pool: stats
  });
});

// Strategy provider registry health check
router.get('/strategies', (req, res) => {
  const providerStatus = {};
  
  for (const [name, fn] of Object.entries(providers)) {
    providerStatus[name] = {
      registered: true,
      isFunction: typeof fn === 'function',
      status: typeof fn === 'function' ? 'ready' : 'invalid'
    };
  }
  
  const allReady = Object.values(providerStatus).every(p => p.status === 'ready');
  
  res.json({
    ok: allReady,
    status: allReady ? 'ok' : 'degraded',
    providers: providerStatus,
    availableProviders: Object.keys(providers),
    timestamp: new Date().toISOString()
  });
});

export default router;

export function healthRoutes(app) {
  app.get('/health', async (req, res) => {
    const { degraded, lastEvent } = getAgentState();
    if (degraded) {
      ndjson('health.degraded', { lastEvent });
      return res.status(503).json({ 
        state: 'degraded', 
        lastEvent,
        timestamp: new Date().toISOString()
      });
    }
    try {
      // 3s timeout probe for health check
      const pool = getSharedPool();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Health probe timeout')), 3000)
      );
      const queryPromise = pool.query('SELECT 1');
      
      await Promise.race([queryPromise, timeoutPromise]);
      
      ndjson('health.ok', {});
      return res.status(200).json({ 
        state: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      });
    } catch (e) {
      ndjson('health.probe.error', { error: String(e.message || e) });
      return res.status(503).json({ 
        state: 'degraded', 
        lastEvent: 'health.probe.error',
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get('/ready', async (req, res) => {
    const { degraded, lastEvent } = getAgentState();
    if (degraded) {
      return res.status(503).json({ 
        status: 'not_ready',
        reason: 'database_degraded',
        lastEvent,
        timestamp: new Date().toISOString()
      });
    }
    try {
      const pool = getSharedPool();
      const result = await pool.query('SELECT 1');
      
      return res.json({ 
        ok: true,
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      return res.status(503).json({ 
        status: 'not_ready',
        reason: 'database_error',
        error: e.message,
        timestamp: new Date().toISOString()
      });
    }
  });
}