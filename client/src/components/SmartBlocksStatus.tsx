import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  Clock, 
  RefreshCw, 
  AlertCircle,
  Zap,
  MapPin,
  Sparkles
} from 'lucide-react';

interface SmartBlocksStatusProps {
  strategyStatus?: 'pending' | 'ok' | 'failed' | 'complete';
  strategyReady: boolean;
  isStrategyFetching: boolean;
  hasBlocks: boolean;
  isBlocksLoading: boolean;
  blocksError?: Error | null;
  timeElapsedMs?: number;
  snapshotId?: string | null;
  venueLoadingProgress?: number;
  strategyProgress?: {
    progress: number;
    phase: string;
    statusText: string;
  } | null;
}

export function SmartBlocksStatus({
  strategyStatus,
  strategyReady,
  isStrategyFetching,
  hasBlocks,
  isBlocksLoading,
  blocksError,
  timeElapsedMs,
  snapshotId,
  venueLoadingProgress = 0,
  strategyProgress
}: SmartBlocksStatusProps) {
  // Determine pipeline stage
  const getPipelineStage = () => {
    if (hasBlocks) return 'complete';
    if (blocksError) return 'error';
    if (isBlocksLoading) return 'generating_blocks';
    if (isStrategyFetching || !strategyReady) return 'generating_strategy';
    return 'idle';
  };

  const stage = getPipelineStage();

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50" data-testid="smart-blocks-status">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold text-gray-800">Smart Blocks Pipeline</h3>
          <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">
            Live Status
          </Badge>
        </div>

        <div className="space-y-3">
          {/* Stage 1: Strategy Generation */}
          <div className="flex items-start gap-3">
            {strategyReady ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <div className="relative mt-0.5">
                <RefreshCw className={`w-5 h-5 text-blue-600 flex-shrink-0 ${isStrategyFetching || strategyProgress ? 'animate-spin' : ''}`} />
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">
                AI Strategy Generation
              </p>
              <p className="text-xs text-gray-600">
                {strategyReady 
                  ? '✓ Strategy ready' 
                  : strategyProgress 
                    ? strategyProgress.statusText
                    : isStrategyFetching 
                      ? `Generating... ${timeElapsedMs ? `${Math.round(timeElapsedMs / 1000)}s elapsed` : ''}` 
                      : 'Waiting for strategy...'}
              </p>
              {/* Strategy Progress Bar */}
              {!strategyReady && strategyProgress && strategyProgress.progress > 0 && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full transition-all duration-700"
                      style={{
                        width: `${strategyProgress.progress}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {strategyProgress.phase} - {strategyProgress.progress}%
                  </p>
                </div>
              )}
              {strategyReady && (
                <Badge 
                  variant="outline" 
                  className="mt-1 text-xs border-green-500 text-green-700 bg-green-50"
                >
                  ok
                </Badge>
              )}
            </div>
          </div>

          {/* Stage 2: Smart Blocks Generation */}
          <div className="flex items-start gap-3">
            {hasBlocks ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            ) : blocksError ? (
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            ) : isBlocksLoading ? (
              <RefreshCw className="w-5 h-5 text-blue-600 animate-spin mt-0.5 flex-shrink-0" />
            ) : (
              <Clock className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">
                Smart Blocks (Venue Recommendations)
              </p>
              <p className="text-xs text-gray-600">
                {hasBlocks 
                  ? '✓ Recommendations ready' 
                  : blocksError 
                    ? `Error: ${blocksError.message}`
                    : isBlocksLoading 
                      ? 'Enrichment beginning...'
                      : !strategyReady
                        ? 'Waiting for strategy to complete...'
                        : 'Waiting for worker to generate venues...'}
              </p>
              {(isBlocksLoading || (strategyReady && !hasBlocks && venueLoadingProgress > 0)) && (
                <div className="mt-2">
                  <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 rounded-full transition-all duration-500"
                      style={{
                        width: `${venueLoadingProgress}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Venues can take up to 3 minutes to load
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Stage 3: Location Context */}
          {snapshotId && (
            <div className="flex items-start gap-3 pt-2 border-t border-purple-200">
              <MapPin className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-gray-600">
                  Snapshot ID: <span className="font-mono text-[10px]">{snapshotId.substring(0, 8)}...</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
