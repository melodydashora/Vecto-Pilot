// Coach reads owned context and refreshes canonical settings after a confirmed
// Offer Analyzer save. Strategy admission remains a separate driver action.

import RideshareCoach from '@/components/RideshareCoach';
import { CoachContextStatus, CoachSnapshotStatus } from '@/components/coach/CoachContextStatus';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { useAuth } from '@/contexts/auth-context';
import { useRunSetup } from '@/contexts/run-setup-context';
import { useCoachSnapshot } from '@/hooks/coach/useCoachSnapshot';
import { useCallback } from 'react';
import { MessageSquare } from 'lucide-react';

export default function CoachPage() {
  const { finishSave } = useRunSetup();
  const onOfferRulesSaved = useCallback(() => { void finishSave(); }, [finishSave]);
  const { lastSnapshotId, contextSnapshotId, strategyData, immediateStrategy, snapshotData, blocks, criticalError } = useCoPilot();
  // Before Strategy admission, Coach can read the current owned Briefing even
  // when a section failed. Keep an admitted Strategy paired with its snapshot.
  const sourceSnapshotId = lastSnapshotId || contextSnapshotId || undefined;
  const coachContext = useCoachSnapshot();
  const coachSnapshotId = coachContext.snapshot?.snapshot_id;
  // 2026-09-11 (desktop-coach-review item 1, verified): the Coach identity came from
  // localStorage 'vecto_user_id' || 'default'. Nothing writes that legacy key, so every
  // account keyed its chat thread as vecto_coach_chat_default_* and a second account on the
  // same device inherited the first one's thread. Identity now comes from the AuthProvider;
  // until the user is known nothing is keyed or rendered (no '' / 'default' bucket).
  const { user } = useAuth();
  if (!user) {
    return <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto" data-testid="coach-page-waiting-for-identity" />;
  }
  return (
    <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto" data-testid="coach-page">
      <header className="mb-4 flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-blue-600" />
        <h1 className="text-xl font-semibold">Coach</h1>
      </header>
      {criticalError && (
        <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Some current data is unavailable. The Coach can help with what has arrived and explain what is missing. Strategy remains unavailable until its required data is complete.
        </p>
      )}
      <CoachSnapshotStatus context={coachContext} />
      <CoachContextStatus snapshotId={sourceSnapshotId} coachSnapshotId={coachSnapshotId} />
      <RideshareCoach
        userId={user.userId}
        snapshotId={sourceSnapshotId}
        coachSnapshotId={coachSnapshotId}
        onRefreshCoachSnapshot={coachContext.refresh}
        strategyId={strategyData?.strategyId || undefined}
        strategy={immediateStrategy ?? undefined}
        snapshot={snapshotData}
        blocks={blocks}
        strategyReady={!!immediateStrategy}
        onOfferRulesSaved={onOfferRulesSaved}
      />
    </div>
  );
}
