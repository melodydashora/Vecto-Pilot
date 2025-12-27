import { useEffect, useState } from 'react';

export type BriefingItem = {
  title?: string;
  name?: string;
  area?: string;
  url?: string;
  summary?: string;
  startTime?: string;
  venue?: string;
  severity?: 'low' | 'medium' | 'high';
  note?: string;
  date?: string;
  impact?: string;
};

export type Briefing = {
  news?: BriefingItem[];
  events?: BriefingItem[];
  traffic?: BriefingItem[];
  holidays?: BriefingItem[];
  school_closures?: BriefingItem[];
};

export type StrategyData = {
  snapshot_id: string;
  status: 'missing' | 'pending' | 'running' | 'ok' | 'ok_partial' | 'error';
  strategy?: {
    min?: string;
    consolidated?: string;
    briefing?: Briefing;
    holiday?: any;
    user?: {
      address?: string;
      city?: string;
      state?: string;
    };
  };
  waitFor?: string[];
  timeElapsedMs?: number;
  error_message?: string | null;
};

export function useStrategy(snapshotId?: string) {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState<boolean>(!!snapshotId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let pollTimeout: NodeJS.Timeout | null = null;
    // CRITICAL FIX: Use AbortController to prevent memory leaks from pending fetch requests
    const abortController = new AbortController();
    
    if (!snapshotId) {
      setData(null);
      setLoading(false);
      return;
    }

    const fetchStrategy = async () => {
      try {
        if (!active) return;
        
        const response = await fetch(`/api/blocks/strategy/${snapshotId}`, {
          signal: abortController.signal,
          credentials: 'include'
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const d = await response.json();
        
        if (!active) return;
        
        setData(d);
        setLoading(false);
        
        // Poll every 2s until strategy is ready (ok or ok_partial) or error
        const shouldPoll = d.status === 'pending' || d.status === 'running';
        if (shouldPoll && active) {
          pollTimeout = setTimeout(fetchStrategy, 2000);
        }
      } catch (err: any) {
        if (!active || err.name === 'AbortError') return;
        setError(err.message);
        setLoading(false);
      }
    };

    setLoading(true);
    setError(null);
    fetchStrategy();

    return () => {
      active = false;
      if (pollTimeout) clearTimeout(pollTimeout);
      // CRITICAL FIX: Abort in-flight requests to prevent memory leaks
      abortController.abort();
    };
  }, [snapshotId]);

  return { data, loading, error };
}
