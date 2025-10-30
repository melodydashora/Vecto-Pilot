// server/jobs/triad-worker.js
// Background worker that claims and processes triad jobs with SKIP LOCKED
import { db } from '../db/drizzle.js';
import { triad_jobs, strategies, snapshots } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { generateStrategyForSnapshot } from '../lib/strategy-generator.js';

export async function processTriadJobs() {
  while (true) {
    try {
      // Claim one job with SKIP LOCKED (only one worker processes it)
      const [job] = await db.execute(sql`
        UPDATE ${triad_jobs}
        SET status = 'running'
        WHERE id = (
          SELECT id 
          FROM ${triad_jobs}
          WHERE status = 'queued'
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, snapshot_id, kind
      `);

      if (!job || job.rows.length === 0) {
        // No jobs available, wait before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const { id: jobId, snapshot_id, kind } = job.rows[0];

      console.log(`[triad-worker] 🔧 Processing job ${jobId} for snapshot ${snapshot_id}`);

      try {
        // Check if strategy already exists (race condition guard)
        const [existing] = await db
          .select()
          .from(strategies)
          .where(eq(strategies.snapshot_id, snapshot_id))
          .limit(1);

        if (existing && existing.status === 'ok') {
          // Strategy already exists, mark job complete
          console.log(`[triad-worker] ✅ Strategy already exists for ${snapshot_id}, marking job complete`);
          await db.execute(sql`
            UPDATE ${triad_jobs}
            SET status = 'ok'
            WHERE id = ${jobId}
          `);
          continue;
        }

        // Generate strategy using existing triad pipeline
        console.log(`[triad-worker] 🧠 Generating strategy for ${snapshot_id}...`);
        const strategy = await generateStrategyForSnapshot(snapshot_id);

        if (!strategy) {
          throw new Error('Strategy generator returned null');
        }

        console.log(`[triad-worker] ✅ Strategy generated successfully for ${snapshot_id}`);

        // Strategy is written by generateStrategyForSnapshot, just mark job complete
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'ok'
          WHERE id = ${jobId}
        `);

      } catch (err) {
        console.error(`[triad-worker] ❌ Job ${jobId} failed:`, err.message);
        
        // Mark job as error
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'error'
          WHERE id = ${jobId}
        `);

        // Update strategy status to failed
        await db.execute(sql`
          UPDATE ${strategies}
          SET status = 'failed', error_message = ${err.message}
          WHERE snapshot_id = ${snapshot_id}
        `);
      }
    } catch (err) {
      console.error('[triad-worker] Worker loop error:', err);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Auto-start worker if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[triad-worker] Starting triad worker...');
  processTriadJobs().catch(err => {
    console.error('[triad-worker] Fatal error:', err);
    process.exit(1);
  });
}
