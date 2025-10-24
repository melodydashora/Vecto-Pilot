import { Router } from 'express';
import { routerDiagnosticsV2 } from '../lib/llm-router-v2.js';
import { getPoolStats } from '../db/pool.js';

const router = Router();

router.get('/', (req, res) => {
  const diag = routerDiagnosticsV2();
  res.json({
    ok: true,
    service: 'Vecto Co-Pilot API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
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

export default router;

export function healthRoutes(app) {
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  app.get('/ready', (req, res) => {
    // Check if database is accessible
    res.json({ 
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  });
}