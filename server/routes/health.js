
import { Router } from 'express';
import { routerDiagnosticsV2 } from '../lib/llm-router-v2.js';

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

export default router;
