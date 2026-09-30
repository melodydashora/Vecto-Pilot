import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SessionCheckProps {
  error?: string | null;
  onRetry: () => Promise<void>;
}

// Shared by both entry routes so a failed connection cannot become a sign-out.
export default function SessionCheck({ error, onRetry }: SessionCheckProps) {
  return <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
    {error ? <div role="alert" className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 text-center shadow-lg space-y-4">
      <p className="text-slate-200">{error}</p>
      <Button onClick={() => { void onRetry(); }}>Try again</Button>
    </div> : <div role="status" className="flex flex-col items-center gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      <p className="text-slate-400">Loading...</p>
    </div>}
  </div>;
}
