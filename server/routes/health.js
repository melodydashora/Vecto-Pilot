
import { Router } from 'express';
import { routerDiagnosticsV2 } from '../lib/llm-router-v2.js';

const router = Router();

router.get('/', (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  const diag = routerDiagnosticsV2();
  res.status(200).json({
    status: "ok",
    ok: true,
    service: 'Vecto Co-Pilot API',
    time: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid,
    llm: diag
  });
});

router.get('/verify-override', (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.status(200).json({
    ok: true,
    override_active: true,
    time: new Date().toISOString()
  });
});

export default router;
