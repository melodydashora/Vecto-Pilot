// server/jobs/triad-worker.js
// Background worker that claims and processes triad jobs with SKIP LOCKED
// Strategy building flow: NO VENUES (that's a separate flow for blocks)
import { db } from '../db/drizzle.js';
import { triad_jobs, strategies, snapshots } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { callClaude45Raw } from '../lib/adapters/anthropic-sonnet45.js';
import { callGPT5 } from '../lib/adapters/openai-gpt5.js';
import { acquireLock, releaseLock, extendLock } from '../lib/locks.js';

const LOCK_TTL_MS = Number(process.env.LOCK_TTL_MS || 9000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 3000);

export async function processTriadJobs() {
  console.log('[triad-worker] 🔄 Worker loop started, polling for jobs...');
  
  while (true) {
    try {
      console.log('[triad-worker] 🔍 Checking for queued jobs...');
      
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
        console.log('[triad-worker] ⏸️ No queued jobs, waiting 1s...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const { id: jobId, snapshot_id, kind } = job.rows[0];

      console.log(`[triad-worker] 🔧 CLAIMED job ${jobId} for snapshot ${snapshot_id}`);

      // LOCK: Acquire per-snapshot lock to prevent concurrent processing
      const lockKey = `triad:${snapshot_id}`;
      console.log(`[triad-worker] 🔑 Attempting to acquire lock: ${lockKey}`);
      
      const gotLock = await acquireLock(lockKey, LOCK_TTL_MS);
      
      if (!gotLock) {
        // Lock busy - mark job failed and skip
        console.error(`[triad-worker] ❌ Lock busy for ${snapshot_id}, marking job FAILED`);
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'error', error_message = 'Lock busy - another worker processing this snapshot'
          WHERE id = ${jobId}
        `);
        continue;
      }

      console.log(`[triad-worker] ✅ Lock acquired: ${lockKey}, TTL=${LOCK_TTL_MS}ms`);

      // Heartbeat timer to extend lock during long-running operations
      let heartbeat = setInterval(async () => {
        try {
          await extendLock(lockKey, LOCK_TTL_MS);
          console.log(`[triad-worker] 💓 Lock heartbeat: ${lockKey}`);
        } catch (e) {
          console.error(`[triad-worker] ❌ Lock heartbeat error:`, e?.message || e);
        }
      }, HEARTBEAT_MS);

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
          await releaseLock(lockKey);
          continue;
        }

        // STEP 1: Fetch snapshot with Gemini briefing (already created in parallel)
        const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id)).limit(1);
        if (!snap) {
          throw new Error('Snapshot not found');
        }

        console.log(`[triad-worker] ✅ Gemini briefing available: ${snap.news_briefing ? 'YES' : 'NO'}`);

        // STEP 2: Run Claude with snapshot context ONLY (NO VENUES) → persist to strategies.strategy
        console.log(`[triad-worker] 🧠 STEP 2/3: Running Claude strategist...`);
        const clock = new Date().toLocaleString("en-US", {
          timeZone: snap.timezone,
          weekday: "short", 
          hour: "numeric", 
          minute: "2-digit"
        });

        const claudeSys = [
          "You are a senior rideshare strategist.",
          "Analyze the driver's location, time, and conditions to provide strategic positioning advice.",
          "Focus on general patterns: time-of-day demand, weather impact, typical hotspots for this area.",
          "Return a 3-5 sentence strategy text ONLY. No JSON, no venue names, just strategic advice."
        ].join(" ");

        const claudeUser = [
          `Current time: ${clock}`,
          `Driver location: ${snap.formatted_address}`,
          `City: ${snap.city}, ${snap.state}`,
          `Weather: ${snap.weather?.tempF || 'unknown'}°F, ${snap.weather?.conditions || 'unknown'}`,
          `Air Quality: AQI ${snap.air?.aqi || 'unknown'}`,
          ``,
          `Provide strategic positioning advice for a rideshare driver right now. Consider time of day, weather, and location patterns.`
        ].join("\n");

        const claudeRaw = await callClaude45Raw({
          system: claudeSys,
          user: claudeUser
        });

        const claudeStrategy = claudeRaw.trim();
        if (!claudeStrategy || claudeStrategy.length < 20) {
          throw new Error('Claude returned invalid strategy');
        }

        // Persist Claude's intermediate strategy to DB
        await db.update(strategies)
          .set({
            strategy: claudeStrategy,
            updated_at: new Date()
          })
          .where(eq(strategies.snapshot_id, snapshot_id));

        console.log(`[triad-worker] ✅ Claude strategy persisted to strategies.strategy`);

        // STEP 3: Fetch BOTH Claude strategy + Gemini briefing from DB
        const [strategyRow] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshot_id)).limit(1);
        const claudeFromDB = strategyRow.strategy;
        const geminiFromDB = snap.news_briefing?.briefing ? JSON.stringify(snap.news_briefing.briefing) : null;

        // CRITICAL: Verify BOTH fields exist before consolidation
        if (!claudeFromDB || claudeFromDB.length < 20) {
          throw new Error('Claude strategy missing or invalid - cannot consolidate');
        }
        if (!geminiFromDB || geminiFromDB === 'null') {
          throw new Error('Gemini news briefing missing - cannot consolidate');
        }

        console.log(`[triad-worker] 📦 Fetched from DB - Claude: ${claudeFromDB.substring(0, 50)}... | Gemini: ${geminiFromDB.substring(0, 50)}...`);
        console.log(`[triad-worker] ✅ Both Claude and Gemini data verified - proceeding to GPT-5 consolidation`);

        // STEP 4: Run GPT-5 consolidation without precise address in output
        console.log(`[triad-worker] 🤖 STEP 3/3: Running GPT-5 consolidation...`);
        const gpt5SystemPrompt = `You are a rideshare strategy consolidator. Combine Claude's strategy with Gemini's news briefing into a single cohesive 3-5 sentence strategy.

CRITICAL: Never mention street addresses, house numbers, or precise locations in your output. Only use city name and district/landmark names (e.g., "In Frisco near The Star and Legacy West" NOT "From 6068 Midnight Moon Dr").`;

        const gpt5UserPrompt = `DRIVER CONTEXT (for your understanding only - DO NOT echo any addresses in your response):
Location: ${snap.city}, ${snap.state}

CLAUDE STRATEGY:
${claudeFromDB}

GEMINI NEWS BRIEFING:
${geminiFromDB}

Create a consolidated strategy using ONLY city and district names. Start with general positioning advice - do not start with "From [address]".`;

        const gpt5Result = await callGPT5({
          developer: gpt5SystemPrompt,
          user: gpt5UserPrompt,
          max_completion_tokens: 2000
        });

        if (!gpt5Result.text) {
          throw new Error('GPT-5 returned no text');
        }

        // STEP 5: Persist GPT-5 final output + snapshot context to strategies
        await db.update(strategies)
          .set({
            status: 'ok',
            strategy_for_now: gpt5Result.text.trim(),
            model_name: 'claude-4.5→gpt-5',
            user_address: snap.formatted_address,
            city: snap.city,
            state: snap.state,
            lat: snap.lat,
            lng: snap.lng,
            user_id: snap.user_id,
            events: snap.news_briefing?.events || [],
            news: snap.news_briefing?.news || [],
            traffic: snap.news_briefing?.traffic || [],
            updated_at: new Date()
          })
          .where(eq(strategies.snapshot_id, snapshot_id));

        console.log(`[triad-worker] ✅ GPT-5 final strategy persisted to strategies.strategy_for_now`);
        console.log(`[triad-worker] 💾 Final: ${gpt5Result.text.trim().substring(0, 100)}...`);

        // Mark job complete
        await db.execute(sql`
          UPDATE ${triad_jobs}
          SET status = 'ok'
          WHERE id = ${jobId}
        `);

      } catch (err) {
        console.error(`[triad-worker] ❌ Job ${jobId} failed:`, err.message);
        
        // HARD FAIL on constraint errors - schema mismatch, don't retry
        if (String(err?.message).includes('ON CONFLICT') || 
            String(err?.message).includes('constraint') ||
            String(err?.message).includes('unique') ||
            String(err?.code) === '23505') {
          console.error(`[triad-worker] 🛑 SCHEMA MISMATCH - ON CONFLICT or constraint violation detected`);
          console.error(`[triad-worker] 🛑 Fix: Ensure unique index matches ON CONFLICT target`);
          
          // Mark job as failed with schema error
          await db.execute(sql`
            UPDATE ${triad_jobs}
            SET status = 'error'
            WHERE id = ${jobId}
          `);
          
          await db.execute(sql`
            UPDATE ${strategies}
            SET status = 'failed', error_message = 'schema_mismatch_unique_index_required'
            WHERE snapshot_id = ${snapshot_id}
          `);
          
          await releaseLock(lockKey);
          throw new Error('schema_mismatch_unique_index_required: ' + err.message);
        }
        
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
      } finally {
        // Clean up heartbeat and release lock
        try { clearInterval(heartbeat); } catch {}
        await releaseLock(lockKey);
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
