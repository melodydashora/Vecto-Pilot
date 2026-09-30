import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/constants/storageKeys';

interface ReportedMemo {
  id: string;
  type: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
}

export function ReportedMemos({ userId, refreshVersion = 0 }: { userId: string; refreshVersion?: number }) {
  const [memos, setMemos] = useState<ReportedMemo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setMemos([]);
    setLoading(true);
    setError('');
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    void fetch('/api/coach/memos?limit=50', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Reported memos could not be loaded.');
      const body = await response.json();
      if (!Array.isArray(body.memos)) throw new Error('Reported memos could not be read.');
      if (!controller.signal.aborted) setMemos(body.memos);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason.message || 'Reported memos could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [userId, revision, refreshVersion]);

  return <section aria-label="Reported memos" className="space-y-3">
    <p className="text-xs text-gray-600 dark:text-gray-300">Your saved bug reports, feature requests, and observations. Saving a report does not mean the issue is fixed.</p>
    <button type="button" onClick={retry} className="text-sm text-blue-700 dark:text-blue-300 underline">Refresh reported memos</button>
    {loading ? <p role="status">Loading reported memos…</p> : error ? <p role="alert">{error} Use Refresh to try again.</p> : memos.length === 0 ? <p>No reported memos yet.</p> : memos.map(memo => <article key={memo.id} className="rounded-lg border p-3 space-y-1 break-words">
      <p className="text-xs text-gray-500">{memo.type.replace(/_/g, ' ')} · Saved {new Date(memo.created_at).toLocaleDateString()}</p>
      <h4 className="font-medium text-sm">{memo.title}</h4>
      <p className="text-xs whitespace-pre-wrap">{memo.detail}</p>
      <p className="text-xs text-gray-500">Receipt {memo.id.slice(0, 8)}</p>
    </article>)}
  </section>;
}
