// server/lib/blocks-job-queue.js
// Simple in-process job queue for async /api/blocks processing
// Returns 202 Accepted immediately, processes in background

import { randomUUID } from 'crypto';

const jobs = new Map(); // jobId -> { status, payload, result, error }
const queue = []; // Array of jobIds waiting to process
let processing = false;

/**
 * Enqueue a blocks job and return jobId
 * @param {Object} payload - Request body from POST /api/blocks
 * @returns {string} jobId
 */
export function enqueueBlocksJob(payload) {
  const jobId = randomUUID();
  
  jobs.set(jobId, {
    id: jobId,
    status: 'queued',
    payload,
    createdAt: Date.now(),
    result: null,
    error: null
  });
  
  queue.push(jobId);
  console.log(`[blocks-queue] Job ${jobId} queued (${queue.length} in queue)`);
  
  // Trigger processing if not already running
  setImmediate(() => processQueue());
  
  return jobId;
}

/**
 * Get job status
 * @param {string} jobId
 * @returns {Object|null} Job object or null
 */
export function getJobStatus(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Process queue - runs one job at a time
 * Can be modified to process multiple concurrently if needed
 */
async function processQueue() {
  if (processing || queue.length === 0) return;
  
  processing = true;
  
  while (queue.length > 0) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    
    if (!job) continue;
    
    console.log(`[blocks-queue] Processing job ${jobId}...`);
    job.status = 'processing';
    job.startedAt = Date.now();
    
    try {
      // Import the original blocks handler logic
      const { processBlocksRequest } = await import('../routes/blocks-processor.js');
      
      const result = await processBlocksRequest(job.payload);
      
      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
      job.elapsed = job.completedAt - job.startedAt;
      
      console.log(`[blocks-queue] ✅ Job ${jobId} completed in ${job.elapsed}ms`);
      
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = Date.now();
      job.elapsed = job.completedAt - job.startedAt;
      
      console.error(`[blocks-queue] ❌ Job ${jobId} failed:`, error.message);
    }
    
    // Yield to event loop between jobs
    await new Promise(r => setImmediate(r));
  }
  
  processing = false;
}

/**
 * Clean up completed jobs older than 5 minutes
 * Call this periodically to prevent memory leaks
 */
export function cleanupOldJobs() {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [jobId, job] of jobs.entries()) {
    if (job.status === 'completed' || job.status === 'failed') {
      if (now - job.createdAt > maxAge) {
        jobs.delete(jobId);
      }
    }
  }
}

// Cleanup every 2 minutes
setInterval(cleanupOldJobs, 2 * 60 * 1000);
