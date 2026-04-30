// 2026-04-25 (Phase A, Pass 1): Dedicated Coach surface.
// This is a pure relocation of the existing <RideshareCoach> from inside
// StrategyPage to its own route. Internals are unchanged in this pass —
// do not refactor speech/TTS/state inside RideshareCoach yet (Pass 2 + Phase B).
//
// Prop names mirror StrategyPage's existing invocation EXACTLY (verified via
// preflight grep at lines 879–887): userId, snapshotId, strategyId, strategy,
// snapshot, blocks, strategyReady.

import RideshareCoach from '@/components/RideshareCoach';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { MessageSquare } from 'lucide-react';

export default function CoachPage() {
  const { lastSnapshotId, strategyData, immediateStrategy, snapshotData, blocks } = useCoPilot();
  return (
    <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto" data-testid="coach-page">
      <header className="mb-4 flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-semibold">Coach</h1>
      </header>
      <RideshareCoach
        userId={localStorage.getItem('vecto_user_id') || 'default'}
        snapshotId={lastSnapshotId || undefined}
        strategyId={strategyData?.strategyId || undefined}
        strategy={immediateStrategy}
        snapshot={snapshotData}
        blocks={blocks}
        strategyReady={!!immediateStrategy}
      />
    </div>
  );
}
