import { sourceTimeLabel } from '@/lib/strategy-source-time';

export function StrategySourceTime({ updatedAt, snapshotCreatedAt, timezone }: {
  updatedAt?: string | null; snapshotCreatedAt?: string | null; timezone?: string | null;
}) {
  const updated = sourceTimeLabel(updatedAt, timezone);
  const captured = sourceTimeLabel(snapshotCreatedAt, timezone);
  return <div className="space-y-1 text-xs text-slate-600" aria-label="Strategy source times">
    <p>Strategy updated: {updated ? <time dateTime={updatedAt!}>{updated}</time> : 'Time unavailable'}</p>
    <p>Data as of: {captured ? <time dateTime={snapshotCreatedAt!}>{captured}</time> : 'Time unavailable'}</p>
  </div>;
}
