
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { jobQueue } from '../../lib/infrastructure/job-queue.js';

const router = Router();

// 2026-05-13 SECURITY (Item 7 of auth-hardening): gate /api/job-metrics
// behind requireAuth. Endpoint exposes internal job-queue state useful to
// attackers for fingerprinting; no external consumer requires unauth.
router.use(requireAuth);

// 2026-04-25 (P1-6): Use mount-relative paths. Mounted at /api/job-metrics in
// server/bootstrap/routes.js, so the prior absolute paths doubled the prefix
// (effective URL was /api/job-metrics/api/metrics/jobs) and the documented
// /api/job-metrics endpoint 404'd.
router.get('/', (req, res) => {
  const metrics = jobQueue.getMetrics();
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...metrics
  });
});

router.get('/:jobId', (req, res) => {
  const status = jobQueue.getStatus(req.params.jobId);
  
  if (!status) {
    return res.status(404).json({ ok: false, error: 'job_not_found' });
  }
  
  res.json({ ok: true, job: status });
});

export default router;
