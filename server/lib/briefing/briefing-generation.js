import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq } from 'drizzle-orm';
import { withCurrentMainRun, MainRunAdmissionError } from '../main-run-admission.js';
import { briefings } from '../../../shared/schema.js';

// Carry ownership through each asynchronous pipeline without changing provider
// signatures. No database connection is retained while providers are running.
const generations = new AsyncLocalStorage();
const activeGenerations = new Map();

export function withBriefingGeneration(snapshotId, generationToken, callback, { upstream = false } = {}) {
  const controller = new AbortController();
  const owner = { snapshotId, generationToken, controller, upstream };
  const active = activeGenerations.get(snapshotId) ?? new Set();
  for (const previous of active) {
    if (previous.generationToken !== generationToken) previous.controller.abort(new BriefingSupersededError());
  }
  active.add(owner);
  activeGenerations.set(snapshotId, active);
  return generations.run(owner, async () => {
    try { return await callback(controller.signal); }
    finally {
      active.delete(owner);
      if (!active.size && activeGenerations.get(snapshotId) === active) activeGenerations.delete(snapshotId);
    }
  });
}

export class BriefingSupersededError extends Error {
  constructor() {
    super('Briefing generation was superseded');
    this.name = 'BriefingSupersededError';
  }
}

// This process can stop obsolete preparatory work promptly. Admitted Strategy
// work is separate, and SQL guards remain authoritative across processes.
export function cancelUpstreamBriefingGenerations(snapshotId) {
  for (const owner of activeGenerations.get(snapshotId) ?? []) {
    if (owner.upstream) owner.controller.abort(new BriefingSupersededError());
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
  owner.controller.signal.throwIfAborted();
  try {
    return await withCurrentMainRun(snapshotId, async tx => {
  owner.controller.signal.throwIfAborted();
  const [stored] = await tx.update(briefings).set(updates).where(and(
    eq(briefings.snapshot_id, snapshotId),
    eq(briefings.generation_token, owner.generationToken),
    eq(briefings.status, 'pending'),
  )).returning();
  if (!stored) owner.controller.abort(new BriefingSupersededError());
  return stored || null;
  }, { allowUpstream: true });
  } catch (error) {
    if (error instanceof MainRunAdmissionError) owner.controller.abort(error);
    throw error;
  }
}
