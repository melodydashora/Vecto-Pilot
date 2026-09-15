// These are persisted observations read for this request, never a claim of a live lookup.
export function contextTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function strategyContextState(strategy, briefing) {
  if (!strategy) return 'missing';
  if (strategy.source_state === 'read_failed') return 'read_failed';
  if (['failed', 'error'].includes(strategy.status)) return 'failed';
  if (strategy.status === 'ok' && strategy.strategy_for_now &&
      strategyMatchesBriefing(strategy, briefing?.source_record ?? briefing, strategy.snapshot_id)) return 'complete';
  if (strategy.strategy_for_now) return 'partial';
  return 'pending';
}

export function getCoachContextProgress(context, readAt = new Date()) {
  const { snapshot, strategy, briefing, offerHistory } = context;
  const snapshotRecord = snapshot?.source_record ?? snapshot;
  const snapshotReadiness = getSnapshotReadiness(snapshotRecord, snapshotRecord?.snapshot_id);
  const offerTimes = (offerHistory?.offers || []).map(row => contextTimestamp(row.updated_at || row.created_at)).filter(Boolean).sort();
  const briefingState = briefing?.source_state === 'read_failed' ? 'read_failed'
    : !briefing || briefing.exists === false ? 'missing'
      : briefing.status === 'error' || briefing.readiness?.failed ? 'failed'
        : briefing.readiness?.ready ? 'complete' : 'partial';
  return {
    read_at: contextTimestamp(readAt),
    snapshot: { state: !snapshot ? 'missing' : snapshotReadiness.ready ? 'complete' : 'partial', observed_at: contextTimestamp(snapshot?.created_at || snapshot?.iso_timestamp) },
    strategy: { state: strategyContextState(strategy, briefing), created_at: contextTimestamp(strategy?.created_at), updated_at: contextTimestamp(strategy?.updated_at || strategy?.strategy_timestamp) },
    briefing: { state: briefingState, generated_at: contextTimestamp(briefing?.generated_at), updated_at: contextTimestamp(briefing?.source_record?.updated_at) },
    offers: { state: offerHistory?.source_state || 'unavailable', count: offerHistory?.offers?.length || 0, limit: offerHistory?.limit ?? 20, updated_at: offerTimes.at(-1) || null },
  };
}

export function describeStrategyStatus(strategy, briefing) {
  const state = strategyContextState(strategy, briefing);
  const at = contextTimestamp(strategy?.updated_at || strategy?.strategy_timestamp);
  const label = { missing: 'Not available yet', pending: 'Generation in progress', partial: 'Partial strategy', failed: 'Generation failed', read_failed: 'Read failed', complete: 'Complete saved strategy' }[state];
  return `${label}${at ? ` — last updated ${at}` : ' — update time unavailable'}`;
}
import { getSnapshotReadiness } from '../location/snapshot-readiness.js';
import { strategyMatchesBriefing } from '../strategy/strategy-source.js';
