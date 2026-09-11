// 2026-09-11: Driver-local venue dismissal for the existing ranking/snapshot.
// Votes remain in venue_feedback; append-only actions record reversible display
// state. No venue score, expiry, generation pipeline or catalog row is changed.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { toApiBlock } from '../../validation/transformers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_ACTION = 'venue_feedback_state';
const STATE_VERSION = 1;

export class VenueFeedbackError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function reject(status, code, message) {
  throw new VenueFeedbackError(status, code, message);
}

export function parseVenueFeedbackInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject(400, 'invalid_feedback', 'A venue feedback object is required.');
  }
  const { snapshot_id, ranking_id, place_id, request_id, action, undo_action_id } = body;
  for (const [name, value] of Object.entries({ snapshot_id, ranking_id, request_id })) {
    if (typeof value !== 'string' || !UUID.test(value)) {
      reject(400, 'invalid_feedback', `${name} must be a UUID.`);
    }
  }
  if (typeof place_id !== 'string' || !place_id.trim() || place_id.length > 512 || place_id !== place_id.trim()) {
    reject(400, 'invalid_feedback', 'A canonical place_id is required.');
  }
  if (!['dismiss', 'restore', 'upvote'].includes(action)) {
    reject(400, 'invalid_feedback', 'action must be dismiss, restore or upvote.');
  }
  if (action === 'restore' && (typeof undo_action_id !== 'string' || !UUID.test(undo_action_id))) {
    reject(400, 'invalid_feedback', 'Restore requires the dismissal undo_action_id.');
  }
  if (action !== 'restore' && undo_action_id != null) {
    reject(400, 'invalid_feedback', 'undo_action_id is only valid for restore.');
  }
  const visible = body.visible_place_ids;
  if (!Array.isArray(visible) || visible.length > 3 ||
      visible.some(id => typeof id !== 'string' || !id || id.length > 512) ||
      new Set(visible).size !== visible.length) {
    reject(400, 'invalid_feedback', 'visible_place_ids must contain up to three distinct place IDs.');
  }
  if (body.comment != null && typeof body.comment !== 'string') {
    reject(400, 'invalid_feedback', 'comment must be text.');
  }
  return {
    snapshot_id: snapshot_id.toLowerCase(), ranking_id: ranking_id.toLowerCase(),
    request_id: request_id.toLowerCase(), place_id, action,
    undo_action_id: undo_action_id?.toLowerCase() || null,
    visible_place_ids: visible,
    comment: body.comment ? body.comment.replace(/<[^>]*>/g, '').slice(0, 1000) : null,
  };
}

function validateScope(userId, snapshotId, rankingId) {
  if (typeof userId !== 'string' || !UUID.test(userId)) reject(401, 'authentication_required', 'Authentication is required.');
  if (typeof snapshotId !== 'string' || !UUID.test(snapshotId) ||
      typeof rankingId !== 'string' || !UUID.test(rankingId)) {
    reject(400, 'invalid_scope', 'snapshotId and rankingId must be UUIDs.');
  }
}

async function ownedRanking(tx, userId, snapshotId, rankingId, lock = false) {
  validateScope(userId, snapshotId, rankingId);
  const result = await tx.execute(sql`
    SELECT r.ranking_id, r.snapshot_id FROM rankings r
    JOIN snapshots s ON s.snapshot_id = r.snapshot_id
    WHERE r.ranking_id = ${rankingId}::uuid AND r.snapshot_id = ${snapshotId}::uuid
      AND r.user_id = ${userId}::uuid AND s.user_id = ${userId}::uuid
    ${lock ? sql`FOR UPDATE OF r` : sql``}
  `);
  if (!result.rows[0]) reject(404, 'ranking_not_found', 'This recommendation scope is unavailable.');
}

async function readLedger(tx, userId, snapshotId, rankingId) {
  const result = await tx.execute(sql`
    SELECT action_id, raw FROM actions
    WHERE user_id = ${userId}::uuid AND snapshot_id = ${snapshotId}::uuid
      AND ranking_id = ${rankingId}::uuid AND action = ${STATE_ACTION}
      AND raw->>'version' = ${String(STATE_VERSION)}
    ORDER BY (raw->>'scope_revision')::bigint DESC LIMIT 1
  `);
  return result.rows[0]?.raw || { scope_revision: 0, dismissals: [], visible_place_ids: [] };
}

function eligible(block) {
  const { lat, lng } = block.coordinates || {};
  return typeof block.placeId === 'string' && !!block.placeId && !block.notWorth &&
    ['A', 'B'].includes(block.valueGrade?.toUpperCase()) &&
    Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 &&
    (!Number.isFinite(block.estimatedDistanceMiles) || block.estimatedDistanceMiles <= 25);
}

function milesBetween(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.coordinates.lat - a.coordinates.lat);
  const dLng = radians(b.coordinates.lng - a.coordinates.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.coordinates.lat)) *
    Math.cos(radians(b.coordinates.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

// Match StrategyPage's A/B and preferred-one-mile policy while using place_id
// for identity. Confirmed visible cards keep their slots before choosing extras.
export function selectVenueFeedbackBlocks(blocks, excludedIds = [], preferredIds = []) {
  const excluded = new Set(excludedIds);
  const unique = new Map();
  for (const block of blocks) {
    if (eligible(block) && !excluded.has(block.placeId) && !unique.has(block.placeId)) unique.set(block.placeId, block);
  }
  const candidates = [...unique.values()].sort((a, b) => {
    const grade = (a.valueGrade.toUpperCase() === 'A' ? 0 : 1) - (b.valueGrade.toUpperCase() === 'A' ? 0 : 1);
    return grade || ((b.valuePerMin || 0) - (a.valuePerMin || 0)) ||
      ((a.estimatedDistanceMiles || 0) - (b.estimatedDistanceMiles || 0));
  });
  const selected = [];
  const used = new Set();
  const add = block => { selected.push(block); used.add(block.placeId); };
  for (const id of preferredIds) if (unique.has(id) && !used.has(id) && selected.length < 3) add(unique.get(id));
  for (const block of candidates) {
    if (selected.length >= 3) break;
    if (!used.has(block.placeId) && selected.every(other => milesBetween(block, other) >= 1)) add(block);
  }
  for (const block of candidates) {
    if (selected.length >= 3) break;
    if (!used.has(block.placeId)) add(block);
  }
  return selected;
}

async function readCandidates(tx, snapshotId, rankingId) {
  const result = await tx.execute(sql`
    SELECT c.*, vc.address AS address FROM ranking_candidates c
    LEFT JOIN venue_catalog vc ON vc.venue_id = c.venue_id
    WHERE c.ranking_id = ${rankingId}::uuid
      AND (c.snapshot_id IS NULL OR c.snapshot_id = ${snapshotId}::uuid)
    ORDER BY c.rank, c.id
  `);
  return result.rows.map(toApiBlock);
}

function stateResponse(snapshotId, rankingId, ledger, blocks) {
  return {
    ok: true, snapshot_id: snapshotId, ranking_id: rankingId,
    scope_revision: ledger.scope_revision,
    dismissals: ledger.dismissals,
    dismissed_place_ids: ledger.dismissals.map(item => item.place_id),
    blocks,
  };
}

async function ownedVote(tx, userId, input) {
  // The actual existing database has only the primary key, not the uniqueness
  // constraint the old ON CONFLICT route assumed. The owned ranking lock above
  // serializes these writes; do not repair ambiguous historical rows by guessing.
  const result = await tx.execute(sql`
    SELECT id, snapshot_id FROM venue_feedback
    WHERE user_id = ${userId}::uuid AND ranking_id = ${input.ranking_id}::uuid AND place_id = ${input.place_id}
    LIMIT 2
  `);
  if (result.rows.length > 1) reject(409, 'ambiguous_feedback', 'Multiple historical feedback records need review before this recommendation can change.');
  const vote = result.rows[0];
  if (vote && vote.snapshot_id !== input.snapshot_id) reject(409, 'feedback_scope_conflict', 'The existing feedback record belongs to a different snapshot.');
  return vote;
}

/** Pure read: no generation, business-hours lookup, address resolver or mutation. */
export async function readSavedVenueFeedback(db, { userId, snapshotId, rankingId }) {
  // One transaction keeps state and candidate reads together; the shared ranking
  // lock also makes this read wait for a currently committing dismissal.
  return db.transaction(async tx => {
    await ownedRanking(tx, userId, snapshotId, rankingId, true);
    const ledger = await readLedger(tx, userId, snapshotId, rankingId);
    const candidates = await readCandidates(tx, snapshotId, rankingId);
    const excluded = ledger.dismissals.map(item => item.place_id);
    return stateResponse(snapshotId, rankingId, ledger, selectVenueFeedbackBlocks(candidates, excluded, ledger.visible_place_ids));
  });
}

/** Existing generated/pending responses retain their other readiness fields. */
export async function applyVenueFeedbackExclusions(db, { userId, snapshotId, rankingId, blocks }) {
  await ownedRanking(db, userId, snapshotId, rankingId);
  const ledger = await readLedger(db, userId, snapshotId, rankingId);
  if (ledger.scope_revision === 0) return { blocks, scope_revision: 0, dismissed_place_ids: [], dismissals: [] };
  const excluded = ledger.dismissals.map(item => item.place_id);
  return {
    blocks: selectVenueFeedbackBlocks(blocks, excluded, ledger.visible_place_ids),
    scope_revision: ledger.scope_revision, dismissed_place_ids: excluded, dismissals: ledger.dismissals,
  };
}

export async function recordVenueFeedback(db, userId, body) {
  const input = parseVenueFeedbackInput(body);
  const fingerprint = createHash('sha256').update(JSON.stringify({ userId, ...input })).digest('hex');
  return db.transaction(async tx => {
    await ownedRanking(tx, userId, input.snapshot_id, input.ranking_id, true);
    const prior = await tx.execute(sql`SELECT user_id, snapshot_id, ranking_id, action, raw FROM actions WHERE action_id = ${input.request_id}::uuid`);
    if (prior.rows[0]) {
      const row = prior.rows[0];
      if (row.user_id !== userId || row.snapshot_id !== input.snapshot_id || row.ranking_id !== input.ranking_id ||
          row.action !== STATE_ACTION || row.raw?.fingerprint !== fingerprint) {
        reject(409, 'request_conflict', 'That request ID has already been used. Retry with a new request ID.');
      }
      return { receipt: row.raw.receipt, replayed: true };
    }
    const ledger = await readLedger(tx, userId, input.snapshot_id, input.ranking_id);
    const candidates = await readCandidates(tx, input.snapshot_id, input.ranking_id);
    const member = candidates.find(block => block.placeId === input.place_id);
    if (!member || !eligible(member)) reject(400, 'place_not_in_ranking', 'This place is not an eligible recommendation in this scope.');
    const eligibleIds = new Set(candidates.filter(eligible).map(block => block.placeId));
    if (input.visible_place_ids.some(id => !eligibleIds.has(id))) reject(400, 'invalid_visible_places', 'A displayed place does not belong to this recommendation scope.');
    if (input.action !== 'restore' && !input.visible_place_ids.includes(input.place_id)) reject(400, 'place_not_visible', 'Only a displayed recommendation can receive feedback.');
    const active = ledger.dismissals.find(item => item.place_id === input.place_id);
    if (input.visible_place_ids.some(id => ledger.dismissals.some(item => item.place_id === id && id !== input.place_id))) {
      reject(409, 'scope_conflict', 'Recommendations changed. Reload the saved recommendations before retrying.');
    }
    let dismissals = [...ledger.dismissals];
    let restored = false;
    if (input.action === 'restore') {
      const undo = await tx.execute(sql`
        SELECT raw FROM actions WHERE action_id = ${input.undo_action_id}::uuid AND action = ${STATE_ACTION}
          AND user_id = ${userId}::uuid AND snapshot_id = ${input.snapshot_id}::uuid AND ranking_id = ${input.ranking_id}::uuid
      `);
      if (undo.rows[0]?.raw?.receipt?.action !== 'dismiss' || undo.rows[0]?.raw?.receipt?.place_id !== input.place_id) {
        reject(409, 'undo_conflict', 'The dismissal to undo is unavailable in this scope.');
      }
      if (active && active.action_id !== input.undo_action_id) reject(409, 'undo_conflict', 'A newer dismissal exists for this recommendation.');
      restored = !!active;
      dismissals = dismissals.filter(item => item.place_id !== input.place_id);
    } else if (input.action === 'dismiss') {
      dismissals = dismissals.filter(item => item.place_id !== input.place_id);
      dismissals.push({ place_id: input.place_id, action_id: input.request_id, venue_name: member.name });
    }
    let feedback = await ownedVote(tx, userId, input);
    if (input.action === 'restore') {
      if (!feedback) reject(409, 'undo_conflict', 'The original feedback receipt is unavailable.');
    } else {
      const sentiment = input.action === 'upvote' ? 'up' : 'down';
      const result = feedback ? await tx.execute(sql`
        UPDATE venue_feedback SET sentiment = ${sentiment}, comment = ${input.comment}, venue_name = ${member.name}
        WHERE id = ${feedback.id}::uuid AND user_id = ${userId}::uuid AND ranking_id = ${input.ranking_id}::uuid
          AND snapshot_id = ${input.snapshot_id}::uuid AND place_id = ${input.place_id}
        RETURNING id
      `) : await tx.execute(sql`
        INSERT INTO venue_feedback (user_id, snapshot_id, ranking_id, place_id, venue_name, sentiment, comment)
        VALUES (${userId}::uuid, ${input.snapshot_id}::uuid, ${input.ranking_id}::uuid, ${input.place_id}, ${member.name}, ${sentiment}, ${input.comment})
        RETURNING id
      `);
      feedback = result.rows[0];
      if (!feedback) reject(409, 'feedback_scope_conflict', 'The feedback record changed before it could be confirmed.');
    }
    const excluded = dismissals.map(item => item.place_id);
    const retained = input.visible_place_ids.filter(id => !excluded.includes(id));
    let originalReplacementId = null;
    // Restore explicitly returns the venue to the visible set. It displaces the
    // replacement from that dismissal when still present, preserving other cards.
    let preferred = retained;
    if (input.action === 'restore' && restored) {
      const undo = await tx.execute(sql`SELECT raw FROM actions WHERE action_id = ${input.undo_action_id}::uuid`);
      const replacementId = undo.rows[0]?.raw?.replacement_place_id ?? undo.rows[0]?.raw?.receipt?.replacement?.placeId;
      preferred = [input.place_id, ...retained.filter(id => id !== replacementId)].slice(0, 3);
    } else if (input.action === 'restore') {
      // A repeated Undo with a fresh request ID can still carry the pre-Undo
      // cards. Keep the already-confirmed list instead of hiding the venue again.
      preferred = ledger.visible_place_ids;
    } else if (active && input.action === 'dismiss') {
      preferred = ledger.visible_place_ids;
      // A distinct retry UUID has its own receipt but creates no new replacement.
      // Retain the original association so a later Undo can remove that card even
      // when the client's A/B grouping changes the visible order.
      const original = await tx.execute(sql`
        SELECT raw FROM actions WHERE action_id = ${active.action_id}::uuid AND action = ${STATE_ACTION}
          AND user_id = ${userId}::uuid AND ranking_id = ${input.ranking_id}::uuid AND snapshot_id = ${input.snapshot_id}::uuid
      `);
      originalReplacementId = original.rows[0]?.raw?.replacement_place_id ?? original.rows[0]?.raw?.receipt?.replacement?.placeId ?? null;
    }
    const blocks = selectVenueFeedbackBlocks(candidates, excluded, preferred);
    const replacement = input.action === 'dismiss' && !active
      ? blocks.find(block => !input.visible_place_ids.includes(block.placeId)) || null : null;
    const nextLedger = { scope_revision: ledger.scope_revision + 1, dismissals, visible_place_ids: blocks.map(block => block.placeId) };
    const receipt = {
      ...stateResponse(input.snapshot_id, input.ranking_id, nextLedger, blocks),
      feedback_id: feedback.id, action_id: input.request_id, place_id: input.place_id, action: input.action,
      replacement, replacement_status: input.action === 'dismiss' && !active
        ? (replacement ? 'replaced' : 'exhausted') : 'not_requested', restored,
    };
    const raw = JSON.stringify({ version: STATE_VERSION, ...nextLedger, fingerprint, receipt,
      replacement_place_id: replacement?.placeId ?? originalReplacementId,
    });
    await tx.execute(sql`
      INSERT INTO actions (action_id, created_at, ranking_id, snapshot_id, user_id, action, block_id, raw)
      VALUES (${input.request_id}::uuid, now(), ${input.ranking_id}::uuid, ${input.snapshot_id}::uuid,
        ${userId}::uuid, ${STATE_ACTION}, ${input.place_id}, ${raw}::jsonb)
    `);
    return { receipt, replayed: false };
  });
}
