import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/drizzle.js';
import { withCurrentMainRun, MainRunAdmissionError } from '../main-run-admission.js';
import { briefings, strategies } from '../../../shared/schema.js';
import { getBriefingReadiness } from '../briefing/briefing-readiness.js';
import { strategyMatchesBriefing, StrategySourceChangedError } from './strategy-source.js';

// A single SQL statement reads one committed pair. Separate reads could combine
// an old Strategy with a new Briefing while another transaction completes.
export async function readStrategySource(snapshotId, tx = db) {
  const [pair] = await tx.select({ strategy: strategies, briefing: briefings })
    .from(strategies).leftJoin(briefings, eq(briefings.snapshot_id, strategies.snapshot_id))
    .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
  if (pair) return pair;
  const [briefing] = await tx.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
  return { strategy: null, briefing: briefing ?? null };
}

export async function assertCurrentStrategySource(snapshotId, tx = db) {
  const pair = await readStrategySource(snapshotId, tx);
  if (!pair.strategy?.strategy_for_now || !strategyMatchesBriefing(pair.strategy, pair.briefing, snapshotId)) throw new StrategySourceChangedError();
  return pair;
}

// Claim only the model stage, in a short transaction. The active run's job
// prevents duplicate waterfalls; this also covers diagnostic/direct callers.
export async function claimStrategySource(snapshotId, generationToken) {
  return withCurrentMainRun(snapshotId, async tx => {
    const [briefing] = await tx.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).for('update').limit(1);
    if (briefing?.generation_token !== generationToken || !getBriefingReadiness(briefing, snapshotId).ready) throw new StrategySourceChangedError();
    const [claimed] = await tx.update(strategies).set({ status: 'running', updated_at: new Date() })
      .where(and(eq(strategies.snapshot_id, snapshotId), eq(strategies.status, 'pending'), isNull(strategies.strategy_for_now))).returning();
    if (!claimed) throw new MainRunAdmissionError(409, 'main_run_busy', 'This Strategy stage has already been claimed.');
    return claimed;
  });
}

// Lock only for the final DB write, never during a model request. Refresh updates
// this same Briefing row, so it cannot change ownership between the token check
// and Strategy persistence. Obsolete success AND failure leave the row intact.
export async function writeStrategySource(snapshotId, generationToken, updates) {
  if (!generationToken) return null;
  return withCurrentMainRun(snapshotId, async tx => {
    const [briefing] = await tx.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).for('update').limit(1);
    if (briefing?.generation_token !== generationToken || !getBriefingReadiness(briefing, snapshotId).ready) return null;
    const now = new Date();
    const values = { ...updates, updated_at: now };
    if (typeof updates.strategy_for_now === 'string' && updates.strategy_for_now.trim()) {
      const source = { snapshot_id: snapshotId, briefing_generation_token: generationToken,
        briefing_generated_at: new Date(briefing.generated_at).toISOString(), strategy_generated_at: now.toISOString() };
      values.venue_cache_metrics = sql`jsonb_set(COALESCE(${strategies.venue_cache_metrics}, '{}'::jsonb), '{strategy_source}', ${JSON.stringify(source)}::jsonb, true)`;
    }
    const [stored] = await tx.update(strategies).set(values)
      .where(and(eq(strategies.snapshot_id, snapshotId), isNull(strategies.strategy_for_now))).returning();
    return stored ?? null;
  });
}

// Only the known cache counters may be merged; telemetry cannot replace or
// supply the source receipt. Atomic JSON merge also preserves concurrent writes.
export function mergeVenueCacheMetrics(metrics) {
  const counters = Object.fromEntries(['hits', 'misses', 'hit_rate'].filter(key => Object.hasOwn(metrics, key)).map(key => [key, metrics[key]]));
  return sql`COALESCE(${strategies.venue_cache_metrics}, '{}'::jsonb) || ${JSON.stringify(counters)}::jsonb`;
}
