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
  enrichmentProgress?: number;
  enrichmentPhase?: 'idle' | 'strategy' | 'blocks';
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
  enrichmentProgress = 0,
  enrichmentPhase = 'idle'
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

  // ALWAYS show progress bars - don't hide them
  const showStrategyProgress = enrichmentPhase === 'strategy' || (enrichmentPhase === 'blocks' && enrichmentProgress < 30);
  const showBlocksProgress = enrichmentPhase === 'blocks';

  return (
    <Card className="border-2 border-purple-400 bg-gradient-to-br from-purple-50 to-indigo-50 shadow-lg" data-testid="smart-blocks-status">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-purple-600 animate-pulse" />
          <h3 className="font-bold text-gray-900">Smart Blocks Pipeline</h3>
          <Badge className="bg-purple-500 text-white border-0 text-xs animate-pulse">
            🔄 Live Status
          </Badge>
        </div>

        <div className="space-y-3">
          {/* Stage 1: Strategy Generation */}
          <div className="flex items-start gap-3">
            {strategyReady ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <div className="relative mt-0.5">
                <RefreshCw className={`w-5 h-5 text-blue-600 flex-shrink-0 ${isStrategyFetching ? 'animate-spin' : ''}`} />
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">
                AI Strategy Generation
              </p>
              <p className="text-xs text-gray-600">
                {strategyReady 
                  ? '✓ Strategy ready' 
                  : isStrategyFetching 
                    ? `Generating... ${timeElapsedMs ? `${Math.round(timeElapsedMs / 1000)}s elapsed` : ''}` 
                    : 'Waiting for strategy...'}
              </p>
              {strategyReady && (
                <Badge 
                  variant="outline" 
                  className="mt-1 text-xs border-green-500 text-green-700 bg-green-50"
                >
                  ok
                </Badge>
              )}
              {/* Progress bar during strategy phase - ALWAYS VISIBLE */}
              {showStrategyProgress && (
                <div className="mt-2">
                  <div className="w-full bg-green-300 rounded-full h-3 overflow-hidden shadow-md">
                    <div 
                      className="h-full bg-gradient-to-r from-green-600 via-emerald-500 to-green-600 rounded-full transition-all duration-200 shadow-lg"
                      style={{
                        width: `${Math.max(8, Math.min(100, (enrichmentProgress / 30) * 100))}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-green-700 mt-1 font-semibold">
                    🚀 {enrichmentProgress.toFixed(0)}% - AI analyzing location context...
                  </p>
                </div>
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
              {/* Progress bar during blocks phase - ALWAYS VISIBLE when blocks phase */}
              {showBlocksProgress && !hasBlocks && (
                <div className="mt-2">
                  <div className="w-full bg-blue-300 rounded-full h-3 overflow-hidden shadow-md">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-full transition-all duration-200 shadow-lg animate-pulse"
                      style={{
                        width: `${Math.max(8, Math.min(100, (enrichmentProgress - 30) * (100 / 70)))}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-blue-700 mt-1 font-semibold">
                    💫 {enrichmentProgress.toFixed(0)}% - Generating venue recommendations (2-3 mins)
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
                  Snapshot ID: <span className="font-mono text-[10px]">{snapshotId}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
