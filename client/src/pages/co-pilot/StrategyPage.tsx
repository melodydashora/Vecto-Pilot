// client/src/pages/co-pilot/StrategyPage.tsx
// Strategy page with AI recommendations, smart blocks, and coach chat

import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  Navigation,
  TrendingUp,
  Clock,
  Sparkles,
  Zap,
  AlertCircle,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  MessageSquare
} from 'lucide-react';
import { useLocation as useLocationContext } from '@/contexts/location-context-clean';
import { useToast } from '@/hooks/useToast';
import { FeedbackModal } from '@/components/FeedbackModal';
import CoachChat from '@/components/CoachChat';
import { SmartBlocksStatus } from '@/components/SmartBlocksStatus';
import BarsTable from '@/components/BarsTable';
import { GreetingBanner } from '@/components/co-pilot/GreetingBanner';
import { useCoPilot } from '@/contexts/co-pilot-context';
import { useStrategyLoadingMessages } from '@/hooks/useStrategyLoadingMessages';
import { logAction as logActionHelper } from '@/utils/co-pilot-helpers';
import type { SmartBlock } from '@/types/co-pilot';

export default function StrategyPage() {
  const locationContext = useLocationContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get shared state from context
  const {
    coords,
    lastSnapshotId,
    strategyData,
    persistentStrategy,
    immediateStrategy,
    isStrategyFetching,
    snapshotData,
    blocks,
    blocksData,
    isBlocksLoading,
    blocksError,
    refetchBlocks,
    enrichmentProgress,
    strategyProgress,
    pipelinePhase,
    timeRemainingText
  } = useCoPilot();

  // Local state for this page only
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const [dwellTimers, setDwellTimers] = useState<Map<number, number>>(new Map());

  // Feedback modal state
  const [feedbackModal, setFeedbackModal] = useState<{
    isOpen: boolean;
    sentiment: 'up' | 'down' | null;
    block: SmartBlock | null;
    blockIndex: number | null;
  }>({
    isOpen: false,
    sentiment: null,
    block: null,
    blockIndex: null,
  });

  // Strategy feedback modal state
  const [strategyFeedbackOpen, setStrategyFeedbackOpen] = useState(false);

  // Get GPS refresh from location context
  const refreshGPS = locationContext?.refreshGPS;
  const isUpdating = locationContext?.isLoading || false;

  // Cycling loading messages for strategy generation
  const loadingMessages = useStrategyLoadingMessages({ pipelinePhase, timeRemainingText });

  // Log action wrapper
  const logAction = (action: string, blockId?: string, dwellMs?: number, fromRank?: number) => {
    logActionHelper(blocksData?.ranking_id, action, blockId, dwellMs, fromRank);
  };

  const metadata = blocksData?.metadata;

  // Log view action when blocks are loaded
  useEffect(() => {
    if (blocks && blocks.length > 0 && blocksData?.ranking_id) {
      logAction('blocks_viewed');
      console.log(`📊 Logged view action for ${blocks.length} blocks (ranking: ${blocksData.ranking_id})`);
    }
  }, [blocksData?.ranking_id]);

  // Track dwell time for each block using IntersectionObserver
  useEffect(() => {
    if (!blocks.length) return;

    const observers = new Map<number, IntersectionObserver>();

    blocks.forEach((block, index) => {
      const blockElement = document.querySelector(`[data-block-index="${index}"]`);
      if (!blockElement) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const startTime = Date.now();
              setDwellTimers(prev => new Map(prev).set(index, startTime));
            } else {
              const startTime = dwellTimers.get(index);
              if (startTime) {
                const dwellMs = Date.now() - startTime;
                if (dwellMs > 500) {
                  const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
                  logAction('block_dwell', blockId, dwellMs, index + 1);
                }
                setDwellTimers(prev => {
                  const next = new Map(prev);
                  next.delete(index);
                  return next;
                });
              }
            }
          });
        },
        { threshold: 0.5 }
      );

      observer.observe(blockElement);
      observers.set(index, observer);
    });

    return () => {
      observers.forEach(observer => observer.disconnect());
    };
  }, [blocks, blocksData?.ranking_id]);

  const toggleBlockSelection = (blockIndex: number) => {
    const block = blocks[blockIndex];
    if (!block) return;

    const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
    const isSelecting = !selectedBlocks.has(blockIndex);

    setSelectedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockIndex)) {
        next.delete(blockIndex);
      } else {
        next.add(blockIndex);
      }
      return next;
    });

    logAction(
      isSelecting ? 'block_selected' : 'block_deselected',
      blockId,
      undefined,
      blockIndex + 1
    );
  };

  const buildRoute = () => {
    if (selectedBlocks.size === 0) {
      toast({
        title: 'No Blocks Selected',
        description: 'Select at least one block to build your route.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Route Building',
      description: `Building optimized route with ${selectedBlocks.size} location${selectedBlocks.size > 1 ? 's' : ''}...`,
    });

    console.log('Building route with blocks:', Array.from(selectedBlocks));
  };

  const clearSelections = () => {
    setSelectedBlocks(new Set());
    toast({
      title: 'Selections Cleared',
      description: 'All block selections have been removed.',
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 pt-6 pb-6" data-testid="strategy-page">
      {/* Greeting/Holiday Banner */}
      <GreetingBanner holiday={strategyData?.strategy?.holiday} />

      {/* Selection Controls */}
      {selectedBlocks.size > 0 && (
        <Card className="mb-6 border-2 border-blue-500" data-testid="selection-controls">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-800">
                  {selectedBlocks.size} block{selectedBlocks.size !== 1 ? 's' : ''} selected
                </p>
                <p className="text-sm text-gray-600">Ready to build your optimized route</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelections}
                  data-testid="button-clear-selections"
                >
                  Clear All
                </Button>
                <Button
                  size="sm"
                  onClick={buildRoute}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-build-route"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  Build Route
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Strategy Section */}
      <div className="mb-6 space-y-4">
        <div className="sticky top-20 z-10 bg-gradient-to-b from-slate-50 to-white/95 backdrop-blur-sm py-3 -mx-4 px-4 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-800">Current Strategy</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-purple-600 hover:text-purple-700 hover:bg-purple-100 h-8 px-3 text-sm"
            onClick={() => setStrategyFeedbackOpen(true)}
            data-testid="button-strategy-feedback-static"
          >
            <MessageSquare className="w-4 h-4 mr-1" />
            Give Feedback
          </Button>
        </div>

        {/* Strategy Cards */}
        {!coords ? (
          <Card className="bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 border-gray-300 shadow-md" data-testid="strategy-needs-gps">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">GPS Required for Strategy</p>
                  <p className="text-xs text-gray-600">Enable location to receive AI-powered strategic analysis</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : immediateStrategy ? (
          <Card className="bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-50 border-orange-300 shadow-md" data-testid="immediate-strategy-card">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-orange-100">
                  <Zap className="w-5 h-5 text-orange-600 flex-shrink-0" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-orange-900 mb-2">🎯 Where to Go NOW</p>
                  <p
                    className="text-sm text-gray-800 leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: immediateStrategy
                        .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-orange-800 font-semibold">$1</strong>')
                        .replace(/\n/g, '<br />')
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : strategyData?.status === 'failed' ? (
          <Card className="bg-gradient-to-br from-red-50 via-pink-50 to-red-50 border-red-300 shadow-md" data-testid="strategy-failed-card">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-red-100">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-900 mb-1">❌ Strategy Generation Failed</p>
                  <p className="text-xs text-red-700">We couldn't generate a strategy this time. Please try again.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border-blue-300 shadow-md" data-testid="strategy-pending-card">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-blue-600 animate-pulse flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-blue-900">⏳ Generating your strategy...</p>
                    <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                      {loadingMessages.badge}
                    </Badge>
                  </div>
                  <p className="text-xs text-blue-700 mb-3 transition-opacity duration-300">
                    {loadingMessages.icon} {loadingMessages.text}
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-blue-700">
                      <span>Progress</span>
                      <span className="font-mono">{strategyProgress}%</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(strategyProgress, 100)}%` }}
                      />
                    </div>
                    <div className="space-y-1 mt-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-blue-600 italic">{loadingMessages.step}</p>
                        {loadingMessages.timeRemaining && (
                          <p className="text-xs text-blue-500">{loadingMessages.timeRemaining}</p>
                        )}
                      </div>
                      <div className="flex gap-1 justify-center mt-1">
                        {Array.from({ length: loadingMessages.messageCount }).map((_, i) => (
                          <span
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                              i === loadingMessages.currentIndex ? 'bg-blue-600 scale-125' : 'bg-blue-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Smart Blocks Section */}
      {blocks.length > 0 && (
        <div className="mb-6" id="blocks-section">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-800">Closest High-Earning Spots</h2>
              <Badge className="bg-purple-100 text-purple-700 border-0">Smart Blocks</Badge>
              {metadata && (
                <>
                  <span className="text-sm text-gray-500">
                    {metadata.totalBlocks} location{metadata.totalBlocks !== 1 ? 's' : ''}
                  </span>
                  {metadata.validation?.status && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        metadata.validation.status === 'ok'
                          ? 'border-green-500 text-green-700 bg-green-50'
                          : 'border-yellow-500 text-yellow-700 bg-yellow-50'
                      }`}
                      data-testid="validation-badge"
                    >
                      {metadata.validation.status === 'ok' ? '✓ Validated' : '⚠ Validation Issues'}
                    </Badge>
                  )}
                  {metadata.processingTimeMs && (
                    <span className="text-xs text-gray-400">
                      {(metadata.processingTimeMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Bars Table */}
          <BarsTable blocks={blocks} />

          {/* Blocks List */}
          <div className="space-y-4 mt-4" data-testid="blocks-list">
            {blocks.map((block, index) => {
              let cardGradient = 'bg-white border-gray-200';
              if (index <= 1) {
                cardGradient = 'bg-gradient-to-br from-red-50 via-orange-50 to-amber-50 border-orange-300';
              } else if (index <= 3) {
                cardGradient = 'bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 border-yellow-300';
              } else if (Number(block.estimated_distance_miles ?? 0) <= 5) {
                cardGradient = 'bg-gradient-to-br from-blue-50 via-cyan-50 to-sky-50 border-blue-300';
              } else {
                cardGradient = 'bg-gradient-to-br from-purple-50 via-violet-50 to-fuchsia-50 border-purple-300';
              }

              return (
                <Card
                  key={index}
                  className={`border-2 shadow-md hover:shadow-xl transition-all ${cardGradient}`}
                  data-testid={`block-${index}`}
                  data-block-index={index}
                >
                  <CardContent className="p-4">
                    {/* Block Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-2 flex-1">
                        <MapPin className="w-5 h-5 text-blue-600 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900 text-base">{block.name}</h3>
                            {block.isOpen === true && (
                              <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">Open</Badge>
                            )}
                            {block.isOpen === false && (
                              <Badge className="bg-red-100 text-red-700 border-red-300 text-xs">Closed</Badge>
                            )}
                            {block.hasEvent && block.eventBadge && (
                              <Badge className="bg-gradient-to-r from-pink-100 to-purple-200 text-purple-700 border-purple-300 text-xs font-normal">
                                <span className="text-xs">🎫 Event: {block.eventBadge}</span>
                              </Badge>
                            )}
                          </div>
                          {block.address && (
                            <p className="text-sm text-gray-500 mt-0.5">{block.address}</p>
                          )}
                        </div>
                      </div>
                      {block.demandLevel === 'high' && (
                        <Badge className="bg-red-100 text-red-700 border-0 text-xs px-2 py-0.5">high priority</Badge>
                      )}
                    </div>

                    {/* Metrics Row */}
                    <div className="grid grid-cols-3 gap-4 mb-3">
                      <div className="text-center">
                        {(() => {
                          const distance = Number(block.estimated_distance_miles ?? 0);
                          const isNearby = distance <= 5;

                          if (index <= 1) {
                            return (
                              <div className="flex flex-col items-center">
                                <div className="text-2xl mb-1">🔥</div>
                                <div className="text-sm font-bold text-orange-600">HIGH VALUE</div>
                                <div className="text-xs text-gray-500">Top ranked</div>
                              </div>
                            );
                          } else if (index <= 3) {
                            return (
                              <div className="flex flex-col items-center">
                                <div className="text-2xl mb-1">⭐</div>
                                <div className="text-sm font-bold text-yellow-600">GOOD OPPORTUNITY</div>
                                <div className="text-xs text-gray-500">Recommended</div>
                              </div>
                            );
                          } else if (isNearby) {
                            return (
                              <div className="flex flex-col items-center">
                                <div className="text-2xl mb-1">📍</div>
                                <div className="text-sm font-bold text-blue-600">NEARBY OPTION</div>
                                <div className="text-xs text-gray-500">Close proximity</div>
                              </div>
                            );
                          } else {
                            return (
                              <div className="flex flex-col items-center">
                                <div className="text-2xl mb-1">💡</div>
                                <div className="text-sm font-bold text-purple-600">STRATEGIC</div>
                                <div className="text-xs text-gray-500">Consider timing</div>
                              </div>
                            );
                          }
                        })()}
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-700">
                          {Number(block.estimated_distance_miles ?? 0).toFixed(1)} mi
                          {block.distanceSource === "haversine_fallback" && (
                            <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">est.</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          est drive time {Math.round(Number(block.driveTimeMinutes ?? block.estimatedWaitTime ?? 0))} min
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">
                          {block.surge ?? (block.demandLevel === 'high' ? '1.5' : block.demandLevel === 'medium' ? '1.3' : '1.0')}x
                        </div>
                        <div className="text-xs text-gray-500">Surge</div>
                      </div>
                    </div>

                    {/* Not Worth It Ribbon */}
                    {block.not_worth && (
                      <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-3" data-testid="not-worth-ribbon">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                          <p className="text-sm font-semibold text-red-900">
                            Not worth it ({block.value_per_min?.toFixed(2)}/min)
                          </p>
                        </div>
                      </div>
                    )}

                    {/* AI Badge */}
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
                        🤖 AI Generated
                      </Badge>
                      <span className="text-xs text-gray-500">Live recommendation</span>
                    </div>

                    {/* Business Hours */}
                    {block.businessHours && (
                      <div className="flex items-center gap-2 mb-3 text-sm">
                        <Clock className="w-4 h-4 text-blue-600" />
                        <span className="text-gray-700">{block.businessHours}</span>
                      </div>
                    )}

                    {/* Closed Venue Reasoning */}
                    {!block.isOpen && block.closed_venue_reasoning && (
                      <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <h4 className="text-sm font-semibold text-amber-900 mb-1">Why Go When Closed?</h4>
                            <p className="text-sm text-amber-800">{block.closed_venue_reasoning}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Staging Area */}
                    {block.stagingArea && (
                      <div className="bg-gray-50 rounded-lg p-3 mb-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-gray-600" />
                            <h4 className="text-sm font-semibold text-gray-900">Staging Area</h4>
                            <Badge className="bg-yellow-400 text-yellow-900 border-0 text-xs px-2 py-0">
                              {block.stagingArea.type}
                            </Badge>
                          </div>
                          {block.stagingArea.lat && block.stagingArea.lng && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-blue-400 text-blue-600 hover:bg-blue-50"
                              onClick={() => {
                                const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${block.stagingArea.lat},${block.stagingArea.lng}`;
                                window.open(mapsUrl, '_blank');
                              }}
                              data-testid="button-navigate-staging"
                            >
                              <Navigation className="w-4 h-4 mr-1" />
                              Navigate
                            </Button>
                          )}
                        </div>
                        <div className="ml-6 space-y-1">
                          <p className="text-sm font-medium text-gray-900">{block.stagingArea.name}</p>
                          <p className="text-xs text-gray-600">{block.stagingArea.address}</p>
                          <div className="flex items-center gap-1 mt-2">
                            <Clock className="w-3 h-3 text-gray-500" />
                            <p className="text-xs text-gray-600">{block.stagingArea.walkTime}</p>
                          </div>
                          <p className="text-xs text-gray-500 italic">{block.stagingArea.parkingTip}</p>
                        </div>
                      </div>
                    )}

                    {/* Pro Tips */}
                    {block.proTips && block.proTips.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-900 mb-2">Pro Tips:</h4>
                        <ul className="space-y-1 ml-1">
                          {block.proTips.map((tip, tipIndex) => {
                            const patterns = [
                              { regex: /^Pickup zone:/i, label: 'Pickup Zone:' },
                              { regex: /^Routing:/i, label: 'Routing:' },
                              { regex: /^Positioning:/i, label: 'Positioning:' },
                            ];

                            let formattedTip = tip;
                            let label = '';

                            for (const pattern of patterns) {
                              const match = tip.match(pattern.regex);
                              if (match) {
                                label = pattern.label;
                                formattedTip = tip.replace(match[0], '').trim();
                                break;
                              }
                            }

                            return (
                              <li key={tipIndex} className="text-sm text-gray-600 flex items-start gap-2">
                                <span className="text-gray-400 mt-0.5">•</span>
                                <span>
                                  {label && <span className="font-semibold text-gray-900">{label} </span>}
                                  {formattedTip}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50"
                          onClick={() => setFeedbackModal({ isOpen: true, sentiment: 'up', block, blockIndex: index })}
                          data-testid={`button-thumbs-up-${index}`}
                        >
                          <ThumbsUp className="w-4 h-4 mr-1" />
                          {block.up_count || ''}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setFeedbackModal({ isOpen: true, sentiment: 'down', block, blockIndex: index })}
                          data-testid={`button-thumbs-down-${index}`}
                        >
                          <ThumbsDown className="w-4 h-4 mr-1" />
                          {block.down_count || ''}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => {
                            const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
                            logAction('navigate_google_maps', blockId, undefined, index + 1);
                            window.open(`https://www.google.com/maps/dir/?api=1&destination=${block.coordinates.lat},${block.coordinates.lng}`, '_blank');
                          }}
                          data-testid={`button-navigate-maps-${index}`}
                        >
                          <Navigation className="w-4 h-4 mr-1" />
                          Maps
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-300"
                          onClick={() => {
                            const blockId = `${block.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${block.coordinates.lat}_${block.coordinates.lng}`;
                            logAction('navigate_apple_maps', blockId, undefined, index + 1);
                            window.open(`https://maps.apple.com/?daddr=${block.coordinates.lat},${block.coordinates.lng}`, '_blank');
                          }}
                          data-testid={`button-navigate-apple-${index}`}
                        >
                          <MapPin className="w-4 h-4 mr-1" />
                          Apple
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading State */}
      {isBlocksLoading && blocks.length === 0 && (
        <div className="space-y-4" data-testid="loading-state">
          <Card className="p-8 border-blue-100 bg-blue-50/50">
            <div className="flex items-center gap-3 mb-4">
              <RefreshCw className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
              <div className="flex-1">
                <p className="text-gray-800 font-semibold">
                  {pipelinePhase === 'starting' && 'Starting...'}
                  {pipelinePhase === 'resolving' && 'Examining location...'}
                  {pipelinePhase === 'analyzing' && 'Analyzing area...'}
                  {pipelinePhase === 'immediate' && 'Building strategy...'}
                  {pipelinePhase === 'venues' && 'AI finding venues...'}
                  {pipelinePhase === 'routing' && 'Calculating routes...'}
                  {pipelinePhase === 'places' && 'Fetching venue details...'}
                  {pipelinePhase === 'verifying' && 'Verifying events...'}
                  {pipelinePhase === 'enriching' && 'Enriching venue data...'}
                  {pipelinePhase === 'complete' && 'Loading venues and map...'}
                </p>
                <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden mt-3">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${enrichmentProgress}%` }}
                  />
                </div>
                {timeRemainingText && pipelinePhase !== 'complete' && (
                  <p className="text-xs text-gray-500 text-center mt-2">{timeRemainingText} remaining</p>
                )}
              </div>
            </div>
          </Card>
          {/* Skeleton Cards */}
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-3/4 mb-3"></div>
              <div className="h-4 bg-gray-100 rounded w-1/2 mb-4"></div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="h-12 bg-gray-200 rounded"></div>
                <div className="h-12 bg-gray-200 rounded"></div>
                <div className="h-12 bg-gray-200 rounded"></div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {blocksError && !isBlocksLoading && (
        <Card className="p-8 border-red-200" data-testid="error-state">
          <div className="flex flex-col items-center justify-center text-center">
            <AlertCircle className="w-8 h-8 text-red-600 mb-4" />
            <p className="text-gray-800 font-semibold mb-2">Failed to Load Blocks</p>
            <p className="text-gray-600 text-sm mb-4">
              {blocksError instanceof Error ? blocksError.message : 'Unable to connect to AI engine'}
            </p>
            <Button onClick={() => refetchBlocks()} variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </Card>
      )}

      {/* No GPS State */}
      {!coords && !isBlocksLoading && (
        <Card className="p-8" data-testid="no-gps-state">
          <div className="flex flex-col items-center justify-center text-center">
            <MapPin className="w-8 h-8 text-gray-400 mb-4" />
            <p className="text-gray-800 font-semibold mb-2">GPS Location Required</p>
            <p className="text-gray-600 text-sm mb-4">Enable location services to receive personalized recommendations</p>
            <Button onClick={refreshGPS} disabled={isUpdating}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isUpdating ? 'animate-spin' : ''}`} />
              Enable GPS
            </Button>
          </div>
        </Card>
      )}

      {/* AI Strategy Coach */}
      {coords && (
        <div className="mb-6" data-testid="ai-coach-section">
          <div className="sticky top-20 z-10 bg-gradient-to-b from-slate-50 to-white/95 backdrop-blur-sm py-3 -mx-4 px-4 flex items-center justify-between border-b border-gray-200">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-800">AI Strategy Coach</h2>
              {!persistentStrategy && (
                <Badge variant="secondary" className="text-xs">Strategy Generating...</Badge>
              )}
            </div>
            <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">Live Chat</Badge>
          </div>
          <div className="mt-4">
            <CoachChat
              userId={localStorage.getItem('vecto_user_id') || 'default'}
              snapshotId={lastSnapshotId || undefined}
              strategyId={strategyData?.strategy_id || undefined}
              strategy={persistentStrategy}
              snapshot={snapshotData}
              blocks={blocks}
              strategyReady={!!persistentStrategy}
            />
          </div>
        </div>
      )}

      {/* Smart Blocks Pipeline Status */}
      {coords && (
        <div className="mb-6">
          <SmartBlocksStatus
            strategyReady={strategyData?.status === 'ok' || strategyData?.status === 'complete' || strategyData?.status === 'pending_blocks'}
            isStrategyFetching={isStrategyFetching}
            hasBlocks={blocks.length > 0}
            isBlocksLoading={isBlocksLoading || !!blocksData?.isBlocksGenerating}
            blocksError={blocksError as Error | null}
            timeElapsedMs={strategyData?.timeElapsedMs}
            snapshotId={lastSnapshotId}
            enrichmentProgress={enrichmentProgress}
            enrichmentPhase={''}
            pipelinePhase={pipelinePhase}
          />
        </div>
      )}

      {/* Feedback Modals */}
      <FeedbackModal
        isOpen={feedbackModal.isOpen}
        onClose={() => setFeedbackModal({ isOpen: false, sentiment: null, block: null, blockIndex: null })}
        initialSentiment={feedbackModal.sentiment}
        venueName={feedbackModal.block?.name}
        placeId={feedbackModal.block?.placeId}
        snapshotId={lastSnapshotId || undefined}
        rankingId={blocksData?.ranking_id}
        userId={localStorage.getItem('vecto_user_id') || 'default'}
        onSuccess={(sentiment) => {
          console.log(`Feedback submitted: ${sentiment}`);
        }}
      />

      <FeedbackModal
        isOpen={strategyFeedbackOpen}
        onClose={() => setStrategyFeedbackOpen(false)}
        initialSentiment={null}
        snapshotId={lastSnapshotId || undefined}
        isAppFeedback={true}
      />
    </div>
  );
}
