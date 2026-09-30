import express from 'express';
import { validate, schemas } from '../../middleware/validation.js';
import { db } from '../../db/drizzle.js';
import { actions, snapshots, rankings, ranking_candidates } from '../../../shared/schema.js';
import { and, eq, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { v5 as uuidv5 } from 'uuid';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();
// An existing primary key is the durable idempotency constraint. Owner scoping
// prevents two drivers' identical caller keys from sharing a receipt. No process
// cache, cleanup timer, extra table or deployment migration is needed.
const ACTION_NAMESPACE = 'dcf69544-1a4c-5e8c-9aae-7d559f566c94';
const receiptFields = ['user_id', 'snapshot_id', 'ranking_id', 'action', 'block_id', 'dwell_ms', 'from_rank', 'raw'];
class ActionError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

router.post('/', requireAuth, validate(schemas.action), async (req, res) => {
  try {
    const input = req.validatedBody;
    const action = input.action ?? input.action_type;
    if (!action || (input.action && input.action_type && input.action !== input.action_type)) {
      throw new ActionError(400, 'action_required_or_conflicting');
    }
    if (!input.ranking_id) throw new ActionError(400, 'ranking_id_required');
    const key = req.header('X-Idempotency-Key');
    if (key !== undefined && (typeof key !== 'string' || !key.trim() || key.length > 1024)) {
      throw new ActionError(400, 'invalid_idempotency_key');
    }
    const owner = req.auth.userId;
    const actionId = key ? uuidv5(JSON.stringify([owner, key]), ACTION_NAMESPACE) : randomUUID();
    const result = await db.transaction(async tx => {
      const [ranking] = await tx.select({ snapshot_id: rankings.snapshot_id }).from(rankings)
        .innerJoin(snapshots, eq(snapshots.snapshot_id, rankings.snapshot_id))
        .where(and(eq(rankings.ranking_id, input.ranking_id), eq(rankings.user_id, owner), eq(snapshots.user_id, owner)))
        .limit(1);
      if (!ranking) throw new ActionError(404, 'ranking_not_found');

      let candidate;
      if (input.block_id) {
        [candidate] = await tx.select({ venue_id: ranking_candidates.venue_id, place_id: ranking_candidates.place_id })
          .from(ranking_candidates).where(and(eq(ranking_candidates.ranking_id, input.ranking_id), or(
            eq(ranking_candidates.block_id, input.block_id), eq(ranking_candidates.place_id, input.block_id),
            sql`${ranking_candidates.venue_id}::text = ${input.block_id}`,
          ))).limit(1);
        if (!candidate) throw new ActionError(404, 'ranking_candidate_not_found');
      }
      const record = {
        action_id: actionId, created_at: new Date(), ranking_id: input.ranking_id,
        snapshot_id: ranking.snapshot_id, user_id: owner, action,
        block_id: input.block_id ?? null, dwell_ms: input.dwell_ms ?? null,
        from_rank: input.from_rank ?? null, raw: input.raw ?? input.metadata ?? null,
      };
      const [inserted] = await tx.insert(actions).values(record)
        .onConflictDoNothing({ target: actions.action_id }).returning({ action_id: actions.action_id });
      if (!inserted) {
        const [saved] = await tx.select().from(actions).where(eq(actions.action_id, actionId)).limit(1);
        if (!saved || receiptFields.some(field => !isDeepStrictEqual(saved[field], record[field]))) {
          throw new ActionError(409, 'idempotency_key_conflict');
        }
        return { success: true, action_id: saved.action_id };
      }
      // Commit the winner's action and measured counter together. A failure rolls
      // both back, so a retry never misses or doubles the venue increment.
      if (action === 'click' && candidate) {
        const venueIdentity = candidate.venue_id
          ? sql`vc.venue_id = ${candidate.venue_id}::uuid`
          : sql`vc.place_id = ${candidate.place_id}`;
        await tx.execute(sql`UPDATE venue_metrics vm SET times_chosen = vm.times_chosen + 1
          FROM venue_catalog vc WHERE vc.venue_id = vm.venue_id
          AND ${venueIdentity}`);
      }
      return { success: true, action_id: actionId };
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof ActionError) return res.status(error.status).json({ error: error.code });
    console.error('[actions] Action could not be persisted:', error.code || error.name);
    return res.status(500).json({ error: 'action_persistence_failed' });
  }
});

export default router;
