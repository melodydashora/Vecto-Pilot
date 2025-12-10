
// Background Job Queue with Monitoring
// Tracks fire-and-forget tasks, implements retry logic, and provides metrics

class JobQueue {
  constructor() {
    this.jobs = new Map(); // job_id -> { status, attempts, lastError, createdAt }
    this.metrics = {
      total: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0
    };
    this.maxRetries = 3;
    this.retryDelayMs = 1000; // exponential backoff base
  }

  async enqueue(jobId, jobFn, { maxRetries = this.maxRetries, context = {} } = {}) {
    this.jobs.set(jobId, {
      status: 'pending',
      attempts: 0,
      maxRetries,
      context,
      createdAt: new Date().toISOString(),
      lastError: null
    });
    this.metrics.total++;

    // Execute in microtask queue (fire-and-forget)
    queueMicrotask(() => this._executeWithRetry(jobId, jobFn, maxRetries));

    return jobId;
  }

  async _executeWithRetry(jobId, jobFn, maxRetries) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        job.attempts = attempt;
        job.status = attempt === 1 ? 'running' : 'retrying';
        this.metrics.retrying = attempt > 1 ? this.metrics.retrying + 1 : this.metrics.retrying;

        await jobFn();

        // Success
        job.status = 'succeeded';
        job.completedAt = new Date().toISOString();
        this.metrics.succeeded++;
        if (attempt > 1) this.metrics.retrying--;
        
        console.log(`[job-queue] ✅ ${jobId} succeeded (attempt ${attempt})`);
        return;

      } catch (error) {
        job.lastError = String(error.message || error);
        
        if (attempt < maxRetries) {
          const delayMs = this.retryDelayMs * Math.pow(2, attempt - 1);
          console.warn(`[job-queue] ⚠️ ${jobId} failed attempt ${attempt}, retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          // Final failure
          job.status = 'failed';
          job.completedAt = new Date().toISOString();
          this.metrics.failed++;
          if (attempt > 1) this.metrics.retrying--;
          
          console.error(`[job-queue] ❌ ${jobId} failed permanently after ${attempt} attempts:`, job.lastError);
          
          // Move to dead letter queue
          this._moveToDeadLetter(jobId, job);
        }
      }
    }
  }

  _moveToDeadLetter(jobId, job) {
    // In production, this would write to a database table or external queue
    // For now, keep in memory with DLQ flag
    job.deadLetter = true;
    console.error(`[job-queue] 💀 Dead letter: ${jobId}`, {
      context: job.context,
      attempts: job.attempts,
      lastError: job.lastError
    });
  }

  getStatus(jobId) {
    return this.jobs.get(jobId) || null;
  }

  getMetrics() {
    const activeJobs = Array.from(this.jobs.values()).filter(j => 
      j.status === 'pending' || j.status === 'running' || j.status === 'retrying'
    );
    
    const deadLetterJobs = Array.from(this.jobs.values()).filter(j => j.deadLetter);

    return {
      ...this.metrics,
      active: activeJobs.length,
      deadLetter: deadLetterJobs.length,
      successRate: this.metrics.total > 0 
        ? ((this.metrics.succeeded / this.metrics.total) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  // Cleanup old completed jobs (run periodically)
  cleanup(olderThanMs = 3600000) { // 1 hour default
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && new Date(job.completedAt).getTime() < cutoff && !job.deadLetter) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[job-queue] 🧹 Cleaned up ${cleaned} old jobs`);
    }
  }
}

// Singleton instance
export const jobQueue = new JobQueue();

// Cleanup old jobs every hour
setInterval(() => jobQueue.cleanup(), 3600000);
