import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BriefingStatusNoticeProps {
  snapshotId: string | null;
  isGathering: boolean;
  error: string | null;
  updatesUnavailable: boolean;
}

/** Reports observed Briefing state without replacing navigation or admitting Strategy. */
export function BriefingStatusNotice({ snapshotId, isGathering, error, updatesUnavailable }: BriefingStatusNoticeProps) {
  const [slowSource, setSlowSource] = useState<string | null>(null);
  const gathering = !!snapshotId && isGathering && !error && !updatesUnavailable;
  useEffect(() => {
    setSlowSource(null);
    if (!gathering || !snapshotId) return;
    const timer = window.setTimeout(() => setSlowSource(snapshotId), 45_000);
    return () => window.clearTimeout(timer);
  }, [snapshotId, gathering]);

  const slow = gathering && slowSource === snapshotId;
  if (!error && !updatesUnavailable && !slow) return null;
  const title = error ? 'Some intelligence could not be gathered'
    : updatesUnavailable ? 'Intelligence updates could not be confirmed.'
      : 'Intelligence gathering is taking longer than usual.';
  const description = error || (updatesUnavailable
    ? 'The latest Briefing status is unavailable. This does not confirm whether gathering has finished.'
    : 'The latest confirmed status is still gathering data. Nearby and market events can take longer while locations and schedules are verified. You can review available results or open Coach.');

  return (
    <section className="container mx-auto max-w-4xl px-4 pt-4" aria-label="Briefing status">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <div className="flex items-start gap-3" role="status" aria-live="polite" aria-atomic="true">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 break-words text-sm">{description}</p>
            <p className="mt-2 text-sm">Strategy requires complete intelligence.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/co-pilot/briefing">View Briefing</Link></Button>
          <Button asChild variant="outline"><Link to="/co-pilot/coach">Open Coach</Link></Button>
          <Button asChild variant="outline"><Link to="/co-pilot/settings">Change preferences</Link></Button>
        </div>
      </div>
    </section>
  );
}
