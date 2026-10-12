import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { API_ROUTES } from '@/constants/apiRoutes';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import type { useCoachSnapshot } from '@/hooks/coach/useCoachSnapshot';

interface SourceState { state: string; timezone?: string | null; updated_at?: string | null; observed_at?: string | null; generated_at?: string | null }
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
function at(value: string | null | undefined, sourceTimezone?: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'time unavailable';
  let timezone = sourceTimezone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
  catch { timezone = 'UTC'; }
  return `${new Date(value).toLocaleString(undefined, { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' })} ${timezone}`;
}

export function CoachContextReadout({ progress }: { progress: CoachContextProgress }) {
  const failed = [progress.snapshot, progress.strategy, progress.briefing, progress.offers].some(source => ['failed', 'read_failed'].includes(source.state));
  return <section className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm" aria-label="Coach saved context">
    <p className="font-medium">Coach reads the latest saved information with each question.</p>
    {['missing', 'pending', 'partial'].includes(progress.strategy.state) && <p className="mt-1">You can ask about the available information without starting Strategy.</p>}
    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
      <div><dt className="inline font-medium">Location: </dt><dd className="inline">{labels[progress.snapshot.state] || 'Unverified'} · observed {at(progress.snapshot.observed_at, progress.snapshot.timezone)}</dd></div>
      <div><dt className="inline font-medium">Strategy: </dt><dd className="inline">{labels[progress.strategy.state] || 'Unverified'} · updated {at(progress.strategy.updated_at, progress.strategy.timezone)}</dd></div>
      <div><dt className="inline font-medium">Briefing: </dt><dd className="inline">{labels[progress.briefing.state] || 'Unverified'} · {progress.briefing.generated_at ? `generated ${at(progress.briefing.generated_at, progress.briefing.timezone)}` : `updated ${at(progress.briefing.updated_at, progress.briefing.timezone)}`}</dd></div>
      <div><dt className="inline font-medium">Recent offers: </dt><dd className="inline">{progress.offers.state === 'available' ? `${progress.offers.count} recent (up to ${progress.offers.limit})` : labels[progress.offers.state] || 'Unverified'} · updated {at(progress.offers.updated_at)}</dd></div>
    </dl>
    {failed && <p role="alert" className="mt-2 text-red-700 dark:text-red-400">Some sources failed. You can still ask about the saved information available.</p>}
    <p className="mt-2 text-xs text-muted-foreground">Saved sources checked {at(progress.read_at, progress.snapshot.timezone)}. Each question reads them again; later updates are available on your next question.</p>
  </section>;
}

export function CoachSnapshotStatus({ context }: { context: ReturnType<typeof useCoachSnapshot> }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  const snapshot = context.snapshot;
  const minutes = snapshot ? Math.max(0, Math.floor((now - snapshot.gps_timestamp) / 60_000)) : 0;
  const age = minutes === 0 ? 'just now' : minutes === 1 ? '1 minute ago' : minutes < 60 ? `${minutes} minutes ago`
    : `${Math.floor(minutes / 60)} ${minutes < 120 ? 'hour' : 'hours'} ago`;
  const observed = snapshot ? new Date(snapshot.gps_timestamp).toLocaleString(undefined, {
    timeZone: snapshot.timeZone, dateStyle: 'short', timeStyle: 'short',
  }) : null;
  return <section aria-label="Coach location" className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">Coach location</p>
        {snapshot ? <p className="mt-1">{[snapshot.city, snapshot.state].filter(Boolean).join(', ')} · observed {age}</p>
          : <p className="mt-1 text-muted-foreground">{context.loading ? 'Checking saved Coach location…' : 'Coach refreshes your location when opened.'}</p>}
        {snapshot && <p className="mt-1 text-xs text-muted-foreground">{observed} · {snapshot.timeZone}</p>}
      </div>
      <Button type="button" variant="outline" disabled={!context.canRefresh || context.refreshing}
        aria-label="Refresh Coach context" aria-busy={context.refreshing} onClick={() => void context.refresh()}>
        <RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4${context.refreshing ? ' motion-safe:animate-spin' : ''}`} />
        {context.refreshing ? 'Refreshing Coach context…' : 'Refresh Coach context'}
      </Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Opening Coach refreshes its location, weather and air quality. Your saved Briefing and Strategy keep their original sources.</p>
    {context.refreshing && <p className="mt-2" role="status">Getting a fresh location for Coach…</p>}
    {context.error && <p className="mt-2 text-red-700 dark:text-red-400" role="alert">{context.error}{snapshot ? ' The previous observation is still shown.' : ''}</p>}
  </section>;
}

let nextContextSession = 0;
export function CoachContextStatus({ snapshotId, coachSnapshotId }: { snapshotId?: string; coachSnapshotId?: string }) {
  const { user, token, sessionId } = useAuth();
  const session = useMemo(() => ++nextContextSession, [user?.userId, token, sessionId]);
  const referenceId = snapshotId || coachSnapshotId;
  const query = useQuery<CoachContextProgress>({
    queryKey: ['coach-context-progress', user?.userId, session, snapshotId, coachSnapshotId],
    enabled: !!referenceId && !!user?.userId && !!token,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ summary: '1', ...(coachSnapshotId && { coachSnapshotId }) });
      const response = await fetch(`${API_ROUTES.CHAT.SEND}/context/${encodeURIComponent(referenceId!)}?${query}`, {
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
  if (!referenceId) return <p className="mb-4 text-sm text-muted-foreground">Refresh Coach context to provide your current location.</p>;
  if (query.isError) return <div className="mb-4 text-sm" role="alert">Saved context could not be checked. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button></div>;
  if (!query.data) return <p className="mb-4 text-sm text-muted-foreground" role="status">Checking saved context…</p>;
  return <CoachContextReadout progress={query.data} />;
}
