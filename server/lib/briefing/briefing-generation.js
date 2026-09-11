import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';

// Carry ownership through each asynchronous pipeline without changing provider
// signatures. No database connection is retained while providers are running.
const generations = new AsyncLocalStorage();

export function withBriefingGeneration(snapshotId, generationToken, callback) {
  return generations.run({ snapshotId, generationToken }, callback);
}

export class BriefingSupersededError extends Error {
  constructor() {
    super('Briefing generation was superseded');
    this.name = 'BriefingSupersededError';
  }
}

// Ownership is tested by the UPDATE itself, not a preceding check. The pending
// predicate also rejects late progressive writes after this generation finishes.
export async function writeBriefingGeneration(snapshotId, updates) {
  const owner = generations.getStore();
  if (!owner || owner.snapshotId !== snapshotId || !owner.generationToken) {
    throw new Error('Briefing write requires its snapshot generation owner');
  }
  if ('generation_token' in updates || 'snapshot_id' in updates) {
    throw new Error('Briefing generation writes cannot change ownership');
  }
  const [stored] = await db.update(briefings).set(updates).where(and(
    eq(briefings.snapshot_id, snapshotId),
    eq(briefings.generation_token, owner.generationToken),
    eq(briefings.status, 'pending'),
  )).returning();
  return stored || null;
}
