import type { LiveTranscriptFragment } from '@/lib/voice/live-transcripts';

export function LiveCoachCaptions({ fragments }: { fragments: LiveTranscriptFragment[] }) {
  // Keep speakers independent: listening and speaking can overlap. The original
  // fragments and timestamps stay intact; these rows are display groups only.
  const rows: Array<{ id: string; role: string; fragments: LiveTranscriptFragment[] }> = [];
  for (const fragment of fragments) {
    const previous = rows[rows.length - 1];
    if (previous?.role === fragment.role) previous.fragments.push(fragment);
    else rows.push({ id: fragment.id, role: fragment.role, fragments: [fragment] });
  }
  return <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700" aria-label="Live voice captions">
    <p className="text-xs text-slate-500 dark:text-slate-400">Live captions · automatic transcript</p>
    {rows.map(row => <p key={row.id} className="text-sm text-slate-800 dark:text-slate-200">
      <span className="font-semibold">{row.role === 'user' ? 'You' : 'Coach'}: </span>
      {row.fragments.map(fragment => <span key={fragment.id}>{fragment.text}</span>)}
    </p>)}
  </div>;
}
