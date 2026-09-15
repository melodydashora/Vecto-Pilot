import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { API_ROUTES } from '@/constants/apiRoutes';

interface SourceState { state: string; updated_at?: string | null; observed_at?: string | null; generated_at?: string | null }
export interface CoachContextProgress {
  read_at: string | null;
  snapshot: SourceState;
  strategy: SourceState & { created_at: string | null };
  briefing: SourceState;
  offers: SourceState & { count: number; limit: number };
}

const labels: Record<string, string> = {
  complete: 'Available', partial: 'Partial', pending: 'In progress', missing: 'Not available yet',
  failed: 'Generation failed', read_failed: 'Could not read saved data', available: 'Available', unavailable: 'Unavailable',
};
function at(value: string | null | undefined) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'time unavailable';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function CoachContextReadout({ progress }: { progress: CoachContextProgress }) {
  const failed = [progress.snapshot, progress.strategy, progress.briefing, progress.offers].some(source => ['failed', 'read_failed'].includes(source.state));
  return <section className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm" aria-label="Coach saved context">
    <p className="font-medium">Coach reads the latest saved information with each question.</p>
    {['missing', 'pending', 'partial'].includes(progress.strategy.state) && <p className="mt-1">You can ask about available information while Strategy is being prepared.</p>}
    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
      <div><dt className="inline font-medium">Location: </dt><dd className="inline">{labels[progress.snapshot.state] || 'Unverified'} · observed {at(progress.snapshot.observed_at)}</dd></div>
      <div><dt className="inline font-medium">Strategy: </dt><dd className="inline">{labels[progress.strategy.state] || 'Unverified'} · updated {at(progress.strategy.updated_at)}</dd></div>
      <div><dt className="inline font-medium">Briefing: </dt><dd className="inline">{labels[progress.briefing.state] || 'Unverified'} · {progress.briefing.generated_at ? `generated ${at(progress.briefing.generated_at)}` : `updated ${at(progress.briefing.updated_at)}`}</dd></div>
      <div><dt className="inline font-medium">Recent offers: </dt><dd className="inline">{progress.offers.state === 'available' ? `${progress.offers.count} saved (up to ${progress.offers.limit})` : labels[progress.offers.state] || 'Unverified'} · updated {at(progress.offers.updated_at)}</dd></div>
    </dl>
    {failed && <p role="alert" className="mt-2 text-destructive">Some sources failed. You can still ask about the saved information available.</p>}
    <p className="mt-2 text-xs text-muted-foreground">Saved sources checked {at(progress.read_at)}. Each question reads them again; later updates are available on your next question.</p>
  </section>;
}

let nextContextSession = 0;
export function CoachContextStatus({ snapshotId }: { snapshotId?: string }) {
  const { user, token } = useAuth();
  const session = useMemo(() => ++nextContextSession, [user?.userId, token]);
  const query = useQuery<CoachContextProgress>({
    queryKey: ['coach-context-progress', user?.userId, session, snapshotId],
    enabled: !!snapshotId && !!user?.userId && !!token,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${API_ROUTES.CHAT.SEND}/context/${encodeURIComponent(snapshotId!)}?summary=1`, {
        signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not read saved Coach context');
      return response.json();
    },
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
    gcTime: 0,
  });
  if (!snapshotId) return <p className="mb-4 text-sm text-muted-foreground">Coach is waiting for your location snapshot.</p>;
  if (query.isError) return <div className="mb-4 text-sm" role="alert">Saved context could not be checked. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button></div>;
  if (!query.data) return <p className="mb-4 text-sm text-muted-foreground" role="status">Checking saved context…</p>;
  return <CoachContextReadout progress={query.data} />;
}
