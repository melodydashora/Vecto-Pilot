// server/jobs/triad-worker.js
// Background worker that claims and processes triad jobs with SKIP LOCKED
import { db } from '../db/drizzle.js';
import { triad_jobs, strategies, snapshots, venue_catalog, venue_metrics } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { runTriadPlan } from '../lib/triad-orchestrator.js';
import { scoreCandidate, applyDiversityGuardrails } from '../lib/scoring-engine.js';

export async function processTriadJobs() {
  while (true) {
    try {
      // Claim one job with SKIP LOCKED (only one worker processes it)
      const job = await db.execute(sql`
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

      if (!job || !job.rows || job.rows.length === 0) {
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

        // Fetch snapshot
        const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id)).limit(1);
        if (!snap) {
          throw new Error('Snapshot not found');
        }

        // Build venue catalog and shortlist
        console.log(`[triad-worker] 🏢 Building venue catalog for ${snapshot_id}...`);
        const catalogVenues = await db.select().from(venue_catalog);
        const metricsData = await db.select().from(venue_metrics);
        const metricsMap = new Map(metricsData.map(m => [m.venue_id, m]));
        
        const venuesWithMetrics = catalogVenues.map(v => {
          const metrics = metricsMap.get(v.venue_id);
          return {
            ...v,
            times_recommended: metrics?.times_recommended || 0,
            positive_feedback: metrics?.positive_feedback || 0,
            negative_feedback: metrics?.negative_feedback || 0,
            reliability_score: metrics?.reliability_score || 0.5
          };
        });

        // Score and build shortlist
        const scored = venuesWithMetrics.map(venue => ({
          ...venue,
          score: scoreCandidate(venue, { lat: snap.lat, lng: snap.lng })
        }));
        scored.sort((a, b) => b.score - a.score);
        const diverse = applyDiversityGuardrails(scored, { minCategories: 2, maxPerCategory: 3 });
        const shortlist = diverse.slice(0, 12);
        const catalog = diverse.slice(0, 30);

        console.log(`[triad-worker] 🧠 Running Triad pipeline (Claude + Gemini → GPT-5) for ${snapshot_id}...`);
        const result = await runTriadPlan({ 
          shortlist, 
          catalog, 
          snapshot: snap, 
          goals: "maximize $/hr, minimize unpaid miles" 
        });

        if (!result || !result.strategy_for_now) {
          throw new Error('Triad pipeline returned no strategy_for_now');
        }

        console.log(`[triad-worker] ✅ Triad pipeline complete for ${snapshot_id}`);

        // Persist result to database
        await db.update(strategies)
          .set({
            status: 'ok',
            strategy_for_now: result.strategy_for_now,
            model_name: result.model_route || 'claude→gpt5→gemini',
            updated_at: new Date()
          })
          .where(eq(strategies.snapshot_id, snapshot_id));

        console.log(`[triad-worker] 💾 Strategy persisted: ${result.strategy_for_now.substring(0, 100)}...`);

        // Mark job complete
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
