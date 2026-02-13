import React, { useState, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarSearch, Zap, Loader } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { API_ROUTES, QUERY_KEYS } from '@/constants/apiRoutes';
import { getAuthHeader } from "@/utils/co-pilot-helpers";

interface DailyRefreshCardProps {
  snapshotId?: string;
}

export function DailyRefreshCard({ snapshotId }: DailyRefreshCardProps) {
  const queryClient = useQueryClient();
  const [isRefreshingDaily, setIsRefreshingDaily] = useState(false);
  const [dailyRefreshResult, setDailyRefreshResult] = useState<{
    events: { total: number; inserted: number; skipped: number };
    news: { count: number };
  } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshDailyData = useCallback(async () => {
    if (!snapshotId || isRefreshingDaily) return;

    setIsRefreshingDaily(true);
    setRefreshError(null);

    try {
      console.log('[DailyRefreshCard] Refreshing daily data for snapshot:', snapshotId);
      const response = await fetch(API_ROUTES.BRIEFING.REFRESH_DAILY(snapshotId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh daily data');
      }

      if (data.ok) {
        console.log('[DailyRefreshCard] Daily refresh complete:', {
          events: `${data.events.total_discovered} found, ${data.events.inserted} new`,
          news: `${data.news.count} items`
        });
        setDailyRefreshResult({
          events: {
            total: data.events.total_discovered,
            inserted: data.events.inserted,
            skipped: data.events.skipped
          },
          news: { count: data.news.count }
        });

        // Invalidate React Query cache so UI shows fresh data
        console.log('[DailyRefreshCard] Invalidating query cache for fresh data...');
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_RIDESHARE_NEWS(snapshotId) });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRIEFING_EVENTS(snapshotId) });
      } else {
        throw new Error('No data returned');
      }
    } catch (err) {
      console.error('[DailyRefreshCard] Failed to refresh daily data:', err);
      setRefreshError(err instanceof Error ? err.message : 'Failed to refresh daily data');
    } finally {
      setIsRefreshingDaily(false);
    }
  }, [snapshotId, isRefreshingDaily, queryClient]);

  return (
    <>
      {/* State 1: Not yet run, show refresh button */}
      {!dailyRefreshResult && !isRefreshingDaily && (
        <Card
          className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-300 border-dashed cursor-pointer hover:border-solid hover:shadow-lg transition-all group"
          onClick={refreshDailyData}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg group-hover:scale-105 transition-transform">
                  <CalendarSearch className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-900 text-lg">Refresh Daily Data</h3>
                  <p className="text-sm text-emerald-600">AI-powered search for events + news (SerpAPI, GPT-5.2, Gemini, Claude...)</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 gap-2"
              >
                <Zap className="w-4 h-4" />
                Refresh
              </Button>
            </div>
            {refreshError && (
              <p className="text-red-600 text-sm mt-3">{refreshError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* State 2: Refreshing daily data */}
      {isRefreshingDaily && (
        <Card
          className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-300"
        >
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                <Loader className="w-6 h-6 text-white animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold text-emerald-900 text-lg">Refreshing Daily Data...</h3>
                <p className="text-sm text-emerald-600">Fetching events + news across AI models (may take 30-60s)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 3: Refresh complete - show results */}
      {dailyRefreshResult && !isRefreshingDaily && (
        <Card
          className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-300 shadow-lg"
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
                  <CalendarSearch className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-900 text-lg">Daily Data Refreshed</h3>
                  <p className="text-sm text-emerald-600">
                    Events: {dailyRefreshResult.events.total} found • {dailyRefreshResult.events.inserted} new | News: {dailyRefreshResult.news.count} items
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                  ✅ Complete
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshDailyData}
                  className="bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Refresh Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
