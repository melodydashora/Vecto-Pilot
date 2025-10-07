
import { Router } from 'express';
import { jobQueue } from '../lib/job-queue.js';

const router = Router();

router.get('/metrics/jobs', (req, res) => {
  const metrics = jobQueue.getMetrics();
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...metrics
  });
});

router.get('/metrics/jobs/:jobId', (req, res) => {
  const status = jobQueue.getStatus(req.params.jobId);
  
  if (!status) {
    return res.status(404).json({ ok: false, error: 'job_not_found' });
  }
  
  res.json({ ok: true, job: status });
});

export default router;
