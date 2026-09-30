import { getBriefingReadiness } from '../briefing/briefing-readiness.js';
import { validSnapshotDate } from '../../util/validate-snapshot.js';

export const STRATEGY_SOURCE_RETRY = 'The Briefing changed or this Strategy has no verified source. Refresh your location to create a new Strategy and venue recommendations.';

// The existing JSON column retains its cache counters. This reserved member is
// a source receipt; updated_at also changes during venue progress and cannot be
// used as proof that a Strategy consumed a particular Briefing generation.
export function getStrategySource(strategy) {
  return strategy?.venue_cache_metrics?.strategy_source ?? null;
}

export function strategyMatchesBriefing(strategy, briefing, snapshotId) {
  const source = getStrategySource(strategy);
  return !!source && typeof source.briefing_generation_token === 'string' &&
    !!source.briefing_generation_token && source.briefing_generation_token === briefing?.generation_token &&
    source.snapshot_id === snapshotId && briefing?.snapshot_id === snapshotId &&
    getBriefingReadiness(briefing, snapshotId).ready &&
    validSnapshotDate(source.briefing_generated_at) && validSnapshotDate(briefing.generated_at) &&
    new Date(source.briefing_generated_at).getTime() === new Date(briefing.generated_at).getTime() &&
    validSnapshotDate(source.strategy_generated_at) &&
    new Date(source.strategy_generated_at).getTime() >= new Date(source.briefing_generated_at).getTime();
}

export class StrategySourceChangedError extends Error {
  constructor() {
    super(STRATEGY_SOURCE_RETRY);
    this.name = 'StrategySourceChangedError';
    this.code = 'strategy_source_changed';
  }
}
