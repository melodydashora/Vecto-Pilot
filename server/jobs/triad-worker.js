// server/jobs/triad-worker.js
// Background worker that claims and processes triad jobs with SKIP LOCKED
// Strategy building flow: NO VENUES (that's a separate flow for blocks)
import { db } from '../db/drizzle.js';
import { triad_jobs, strategies, snapshots } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { callClaude45Raw } from '../lib/adapters/anthropic-sonnet45.js';
import { callGPT5 } from '../lib/adapters/openai-gpt5.js';

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

        // STEP 4: Run GPT-5 consolidation with precise location
        console.log(`[triad-worker] 🤖 STEP 3/3: Running GPT-5 consolidation...`);
        const gpt5SystemPrompt = `You are a rideshare strategy consolidator. Combine Claude's strategy with Gemini's news briefing into a single cohesive 3-5 sentence strategy. Include the driver's precise location context.`;

        const gpt5UserPrompt = `DRIVER LOCATION:
Address: ${snap.formatted_address}
City: ${snap.city}, ${snap.state}

CLAUDE STRATEGY:
${claudeFromDB}

GEMINI NEWS BRIEFING:
${geminiFromDB}

Consolidate these into a final strategy that naturally integrates news intelligence with strategic analysis.`;

        const gpt5Result = await callGPT5({
          developer: gpt5SystemPrompt,
          user: gpt5UserPrompt,
          max_completion_tokens: 2000
        });

        if (!gpt5Result.text) {
          throw new Error('GPT-5 returned no text');
        }

        // STEP 5: Persist GPT-5 final output to strategies.strategy_for_now
        await db.update(strategies)
          .set({
            status: 'ok',
            strategy_for_now: gpt5Result.text.trim(),
            model_name: 'claude-4.5→gpt-5',
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
