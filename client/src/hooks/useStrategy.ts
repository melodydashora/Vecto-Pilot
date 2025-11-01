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
};

export type StrategyData = {
  snapshot_id: string;
  status: 'missing' | 'pending' | 'ok';
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
};

export function useStrategy(snapshotId?: string) {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState<boolean>(!!snapshotId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    
    if (!snapshotId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/blocks/strategy/${snapshotId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [snapshotId]);

  return { data, loading, error };
}
