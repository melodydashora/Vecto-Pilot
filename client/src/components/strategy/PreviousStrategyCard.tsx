import { Card, CardContent } from '@/components/ui/card';
import type { PreviousStrategy } from '@/types/co-pilot';
import { StrategyText } from './StrategyText';
import { StrategySourceTime } from './StrategySourceTime';

export function PreviousStrategyCard({ strategy, waiting = true }: { strategy: PreviousStrategy; waiting?: boolean }) {
  const received = new Date(strategy.receivedAt);
  const receivedLabel = Number.isFinite(received.getTime())
    ? `${received.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : null;

  return (
    <Card role="region" aria-label="Previous strategy" data-testid="previous-strategy-card" className="min-w-0 border-slate-300 bg-slate-50 text-left shadow-sm">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="space-y-1">
          <h3 className="font-semibold text-slate-800">Previous strategy</h3>
          <p className="text-sm text-slate-600">
            {waiting ? 'New strategy on the way…' : 'Earlier completed advice, kept for reference.'}
          </p>
          <p className="break-words text-xs text-slate-600">
            {strategy.city && <span>{strategy.city} · </span>}
            {receivedLabel && <>Last received <time dateTime={strategy.receivedAt}>{receivedLabel}</time></>}
          </p>
          <StrategySourceTime updatedAt={strategy.sourceUpdatedAt} snapshotCreatedAt={strategy.snapshotCreatedAt} timezone={strategy.timezone} />
        </div>
        <StrategyText text={strategy.text} className="text-sm leading-relaxed text-slate-800" />
      </CardContent>
    </Card>
  );
}
