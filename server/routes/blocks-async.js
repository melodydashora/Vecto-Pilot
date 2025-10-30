// server/routes/blocks-async.js
// Async /api/blocks endpoint with job queue
// Returns 202 Accepted immediately, processes in background

import express from 'express';
import { newJobId, createJob, startJob, finishJob, failJob, loadJob } from '../lib/blocks-jobs.js';
import { runBlocksJobImpl } from '../lib/blocks-queue.js';

export default function createBlocksAsyncRouter() {
  const router = express.Router();

/**
 * POST /api/blocks/async → 202 { ok: true, jobId }
 * Queues blocks generation job and returns immediately
 */
router.post('/async', async (req, res) => {
  const jobId = newJobId();
  
  try {
    await createJob({ id: jobId, body: req.body });
    
    // Fire-and-forget: do work after response
    res.status(202).json({ ok: true, jobId });
    
    console.log(`[blocks-async] Job ${jobId} queued, starting background processing...`);
    
    // Process job in background (non-blocking)
    queueMicrotask(async () => {
      try {
        await startJob(jobId);
        
        // Import heavy processor dynamically AFTER response to keep boot slim
        const { processBlocksRequestCore } = await import('./blocks-processor.js');
        
        const result = await runBlocksJobImpl(processBlocksRequestCore, req.body);
        await finishJob(jobId, result);
        
        console.log(`[blocks-async] ✅ Job ${jobId} completed`);
      } catch (e) {
        await failJob(jobId, e.message || String(e));
        console.error(`[blocks-async] ❌ Job ${jobId} failed:`, e.message);
      }
    });
    
  } catch (error) {
    console.error('[blocks-async] Failed to create job:', error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to create job',
      message: error.message
    });
  }
});

/**
 * GET /api/blocks/jobs/:id → status + result/error
 * Poll this endpoint to check job status and get results
 */
router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await loadJob(req.params.id);
    
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'job not found'
      });
    }
    
    const { id, status, request_body, result, error, created_at, updated_at } = job;
    
    res.json({
      ok: true,
      id,
      status,
      result: result || null,
      error: error || null,
      created_at,
      updated_at
    });
    
  } catch (error) {
    console.error('[blocks-async] Failed to load job:', error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to load job',
      message: error.message
    });
  }
});

  return router;
}
