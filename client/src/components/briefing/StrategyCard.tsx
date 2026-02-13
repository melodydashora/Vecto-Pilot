import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Zap, Loader, AlertTriangle, Sparkles } from "lucide-react";
import { API_ROUTES } from '@/constants/apiRoutes';
import { getAuthHeader } from "@/utils/co-pilot-helpers";

interface StrategyCardProps {
  snapshotId?: string;
  consolidatedStrategy?: string;
  areCriticalBriefingsLoading: boolean;
}

export function StrategyCard({ snapshotId, consolidatedStrategy, areCriticalBriefingsLoading }: StrategyCardProps) {
  const [showDailyStrategy, setShowDailyStrategy] = useState(!!consolidatedStrategy);
  const [dailyStrategy, setDailyStrategy] = useState<string | null>(consolidatedStrategy || null);
  const [isGeneratingDaily, setIsGeneratingDaily] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);

  // Sync with prop when it changes
  React.useEffect(() => {
    if (consolidatedStrategy && !dailyStrategy) {
      console.log('[StrategyCard] Syncing strategy from prop:', consolidatedStrategy.length, 'chars');
      setDailyStrategy(consolidatedStrategy);
      setShowDailyStrategy(true);
    }
  }, [consolidatedStrategy]);

  const generateDailyStrategy = async () => {
    if (!snapshotId || isGeneratingDaily) return;

    setIsGeneratingDaily(true);
    setDailyError(null);

    try {
      console.log('[StrategyCard] Generating daily strategy for snapshot:', snapshotId);
      const response = await fetch(API_ROUTES.STRATEGY.DAILY(snapshotId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to generate daily strategy');
      }

      if (data.ok && data.consolidated_strategy) {
        console.log('[StrategyCard] Daily strategy generated:', data.consolidated_strategy.length, 'chars');
        setDailyStrategy(data.consolidated_strategy);
        setShowDailyStrategy(true);
      } else {
        throw new Error('No strategy returned');
      }
    } catch (err) {
      console.error('[StrategyCard] Failed to generate daily strategy:', err);
      setDailyError(err instanceof Error ? err.message : 'Failed to generate strategy');
    } finally {
      setIsGeneratingDaily(false);
    }
  };

  return (
    <>
      {/* State 1: No strategy yet, show generate button */}
      {!dailyStrategy && !isGeneratingDaily && !showDailyStrategy && (
        <Card
          className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 border-dashed cursor-pointer hover:border-solid hover:shadow-lg transition-all group"
          onClick={generateDailyStrategy}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg group-hover:scale-105 transition-transform">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-purple-900 text-lg">Daily Strategy Report</h3>
                  <p className="text-sm text-purple-600">Generate AI-powered 8-12 hour strategic briefing</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-purple-300 text-purple-700 hover:bg-purple-100 hover:border-purple-400 gap-2"
              >
                <Zap className="w-4 h-4" />
                Generate Report
              </Button>
            </div>
            {dailyError && (
              <p className="text-red-600 text-sm mt-3">{dailyError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* State 2: Generating strategy */}
      {isGeneratingDaily && (
        <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg">
                <Loader className="w-6 h-6 text-white animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold text-purple-900 text-lg">Generating Daily Strategy...</h3>
                <p className="text-sm text-purple-600">AI is analyzing conditions for your 8-12 hour plan (30-60s)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Show error if generation failed */}
      {dailyError && !isGeneratingDaily && !dailyStrategy && (
        <Card className="bg-red-50 border-red-300">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-red-500 shadow-lg">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 text-lg">Strategy Generation Failed</h3>
                <p className="text-sm text-red-600">{dailyError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={generateDailyStrategy}
                className="bg-white border-red-300 text-red-700 hover:bg-red-100"
              >
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 3: Strategy exists but collapsed */}
      {dailyStrategy && !showDailyStrategy && !isGeneratingDaily && (
        <Card
          className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 border-dashed cursor-pointer hover:border-solid hover:shadow-lg transition-all group"
          onClick={() => setShowDailyStrategy(true)}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg group-hover:scale-105 transition-transform">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-purple-900 text-lg">Daily Strategy Report</h3>
                  <p className="text-sm text-purple-600">AI-generated 8-12 hour strategic briefing</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white border-purple-300 text-purple-700 hover:bg-purple-100 hover:border-purple-400 gap-2"
              >
                <Zap className="w-4 h-4" />
                View Report
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 4: Strategy exists and expanded */}
      {dailyStrategy && showDailyStrategy && (
        areCriticalBriefingsLoading ? (
          <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg">
                  <Loader className="w-6 h-6 text-white animate-spin" />
                </div>
                <div>
                  <h3 className="font-semibold text-purple-900 text-lg">Syncing Briefing Data...</h3>
                  <p className="text-sm text-purple-600">Waiting for traffic and news to populate...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 border-purple-300 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-purple-100">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className="text-purple-900">Today's Strategy</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                    ✅ Complete
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDailyStrategy(false)}
                    className="text-purple-600 hover:text-purple-800 hover:bg-purple-100 text-xs h-7 px-2"
                  >
                    Collapse
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">{dailyStrategy}</p>
            </CardContent>
          </Card>
        )
      )}
    </>
  );
}
