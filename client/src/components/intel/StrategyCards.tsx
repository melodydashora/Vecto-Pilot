/**
 * StrategyCards Component
 *
 * Displays strategic principles for rideshare driving:
 * - The "Ant" Strategy: Volume-focused, best for dense metros
 * - The "Sniper" Strategy: High-value focused, best for sprawl cities
 *
 * Also includes market-specific strategy intelligence cards.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Target, Clock, TrendingUp, Star } from 'lucide-react';
import { useState } from 'react';
import type { IntelligenceItem, MarketArchetype } from '@/hooks/useMarketIntelligence';

// Strategic Principles Cards
export function StrategicPrinciples({ recommendedStrategy }: { recommendedStrategy?: MarketArchetype }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Ant Strategy */}
      <div className={`bg-white p-6 rounded-xl border shadow-sm transition-all ${
        recommendedStrategy === 'dense' ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="bg-blue-100 text-blue-700 p-2 rounded-lg text-xl">⚡</span>
            <h3 className="text-xl font-bold text-gray-900">The "Ant" Strategy</h3>
          </div>
          {recommendedStrategy === 'dense' && (
            <Badge className="bg-blue-100 text-blue-700 border-blue-200">
              <Star className="w-3 h-3 mr-1" /> Recommended
            </Badge>
          )}
        </div>
        <p className="text-sm text-gray-600 mb-4 font-medium">
          Best for Dense Metros &amp; Weekend Quests
        </p>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="text-blue-500 font-bold">✓</span>
            Accept everything under 15 mins.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 font-bold">✓</span>
            Stay in the high-density core.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 font-bold">✓</span>
            Turn on "Stop New Requests" during rides to prevent being dragged out of the zone.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 font-bold">✓</span>
            Goal: Volume (3-4 rides/hr).
          </li>
        </ul>
      </div>

      {/* Sniper Strategy */}
      <div className={`bg-white p-6 rounded-xl border shadow-sm transition-all ${
        recommendedStrategy === 'sprawl' ? 'ring-2 ring-emerald-500 border-emerald-300' : 'border-gray-200'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="bg-emerald-100 text-emerald-700 p-2 rounded-lg text-xl">🎯</span>
            <h3 className="text-xl font-bold text-gray-900">The "Sniper" Strategy</h3>
          </div>
          {recommendedStrategy === 'sprawl' && (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
              <Star className="w-3 h-3 mr-1" /> Recommended
            </Badge>
          )}
        </div>
        <p className="text-sm text-gray-600 mb-4 font-medium">
          Best for Sprawl Cities &amp; Airports
        </p>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 font-bold">✓</span>
            Decline short trips (under $10).
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 font-bold">✓</span>
            Position in wealthy suburbs at 4:00 AM.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 font-bold">✓</span>
            Use Destination Filters aggressively to return to the hub.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 font-bold">✓</span>
            Goal: High $/Mile, low stress.
          </li>
        </ul>
      </div>

      {/* Party Strategy (if applicable) */}
      {recommendedStrategy === 'party' && (
        <div className="md:col-span-2 bg-white p-6 rounded-xl border border-purple-200 shadow-sm ring-2 ring-purple-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="bg-purple-100 text-purple-700 p-2 rounded-lg text-xl">🎉</span>
              <h3 className="text-xl font-bold text-gray-900">The "Night Owl" Strategy</h3>
            </div>
            <Badge className="bg-purple-100 text-purple-700 border-purple-200">
              <Star className="w-3 h-3 mr-1" /> Recommended for Your Market
            </Badge>
          </div>
          <p className="text-sm text-gray-600 mb-4 font-medium">
            Best for Tourism/Party Cities (Vegas, Miami, Nashville, New Orleans)
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-purple-500 font-bold">✓</span>
                Sleep all day, drive 4PM - 4AM.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 font-bold">✓</span>
                Know event schedules (concerts, games, conventions).
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 font-bold">✓</span>
                Stay near nightlife districts after 10PM.
              </li>
            </ul>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-purple-500 font-bold">✓</span>
                Prepare for drunk/difficult passengers.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 font-bold">✓</span>
                Weekends are your money days.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-500 font-bold">✓</span>
                Avoid mornings - it's recovery time for the city.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// Market-specific strategy cards from intelligence API
interface StrategyCardsProps {
  strategies: IntelligenceItem[];
  title?: string;
}

export function MarketStrategies({ strategies, title = 'Market-Specific Strategies' }: StrategyCardsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (strategies.length === 0) {
    return null;
  }

  return (
    <Card className="shadow-lg border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100">
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="w-5 h-5 text-indigo-600" />
          {title}
          <Badge variant="secondary" className="ml-2">
            {strategies.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-3">
          {strategies
            .sort((a, b) => b.priority - a.priority)
            .map((strategy) => {
              const isExpanded = expandedId === strategy.id;
              return (
                <div
                  key={strategy.id}
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-indigo-300 transition-colors"
                >
                  <div
                    className="p-4 cursor-pointer flex items-start justify-between"
                    onClick={() => setExpandedId(isExpanded ? null : strategy.id)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-gray-900">{strategy.title}</h4>
                        {strategy.platform !== 'both' && (
                          <Badge variant="outline" className="text-xs capitalize">
                            {strategy.platform}
                          </Badge>
                        )}
                        {strategy.time_context && (
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            <Clock className="w-3 h-3 mr-1" />
                            Timed
                          </Badge>
                        )}
                      </div>
                      {strategy.summary && !isExpanded && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">{strategy.summary}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className="text-xs text-gray-400 hidden sm:inline">
                        Priority: {strategy.priority}%
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3 animate-in slide-in-from-top-1 duration-200">
                      <p className="text-sm text-gray-700 leading-relaxed">{strategy.content}</p>

                      {strategy.neighborhoods && strategy.neighborhoods.length > 0 && (
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-gray-500 uppercase">Areas:</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {strategy.neighborhoods.map((n, i) => (
                              <span key={i} className="text-xs bg-gray-100 px-2 py-1 rounded">
                                {n}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {strategy.tags && strategy.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {strategy.tags.map((tag, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              #{tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-gray-100 text-xs text-gray-400">
                        <span>Confidence: {strategy.confidence}%</span>
                        <span>Source: {strategy.source}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </CardContent>
    </Card>
  );
}

// Timing advice cards
interface TimingCardsProps {
  timing: IntelligenceItem[];
}

export function TimingAdvice({ timing }: TimingCardsProps) {
  if (timing.length === 0) {
    return null;
  }

  return (
    <Card className="shadow-lg border-cyan-200">
      <CardHeader className="bg-gradient-to-r from-cyan-50 to-sky-50 border-b border-cyan-100">
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyan-600" />
          When to Drive
          <Badge variant="secondary" className="ml-2">{timing.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {timing
            .sort((a, b) => b.priority - a.priority)
            .map((item) => (
              <div
                key={item.id}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:border-cyan-300 transition-colors"
              >
                <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-cyan-600" />
                  {item.title}
                </h4>
                <p className="text-sm text-gray-600 mt-2">{item.summary || item.content.substring(0, 150)}...</p>
                {item.time_context && (
                  <div className="mt-2 text-xs text-cyan-700 font-medium">
                    {typeof item.time_context === 'object' && JSON.stringify(item.time_context)}
                  </div>
                )}
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Named exports only - no default export needed
// Components: StrategicPrinciples, MarketStrategies, TimingAdvice
