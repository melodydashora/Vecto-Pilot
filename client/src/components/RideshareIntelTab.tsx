/**
 * RideshareIntelTab - Market Intelligence & Strategy Hub
 *
 * Location-aware intelligence dashboard that provides:
 * - Auto-detected market based on user's GPS location
 * - Market archetype classification (Sprawl, Dense, Party)
 * - Zone intelligence (honey holes, danger zones, dead zones)
 * - Strategic principles (Ant vs Sniper strategies)
 * - Deadhead risk calculator
 * - Market-specific regulatory and strategy info
 *
 * Fetches data from /api/intelligence API filtered by snapshot location.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronDown,
  ChevronUp,
  Target,
  MapPin,
  Loader2,
  AlertCircle,
  Navigation,
  RefreshCw,
  Globe,
  Shield,
  Plane,
  Lightbulb,
  Building2,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

import { useMarketIntelligence } from '@/hooks/useMarketIntelligence';
import { useLocation } from '@/contexts/location-context-clean';
import { ZoneCards, UniversalZoneLogic, ZoneSummary } from '@/components/intel/ZoneCards';
import { DeadheadCalculator } from '@/components/intel/DeadheadCalculator';
import { StrategicPrinciples, MarketStrategies, TimingAdvice } from '@/components/intel/StrategyCards';

export default function RideshareIntelTab() {
  const { refreshGPS, isUpdating } = useLocation();

  const {
    city,
    state,
    marketSlug,
    isLocationResolved,
    archetype,
    archetypeInfo,
    intelligence,
    isLoading,
    error,
    zones,
    strategies,
    regulatory,
    safety,
    timing,
    airport,
    honeyHoles: _honeyHoles,
    dangerZones: _dangerZones,
    deadZones: _deadZones,
    markets,
    marketsLoading,
    // NEW: Market structure data
    marketAnchor,
    regionType,
    deadheadRisk,
    marketStats,
    marketCities,
  } = useMarketIntelligence();

  // Expand/collapse states
  const [expandedSections, setExpandedSections] = useState({
    marketPosition: true,
    zones: true,
    strategies: true,
    calculator: true,
    safety: false,
    regulatory: false,
    airport: false,
    available: false,
    marketCities: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Archetype color mapping
  const archetypeColorMap = {
    sprawl: { bg: 'from-amber-50 to-orange-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700 border-amber-300' },
    dense: { bg: 'from-blue-50 to-indigo-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700 border-blue-300' },
    party: { bg: 'from-purple-50 to-pink-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700 border-purple-300' },
  };

  const colors = archetypeColorMap[archetype];

  return (
    <div className="space-y-6 mb-24" data-testid="rideshare-intel-section">
      {/* Header with Location Context */}
      <div className="text-center max-w-2xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Target className="w-6 h-6 text-amber-600" />
          <h1 className="text-2xl font-bold text-gray-900">Market Intelligence</h1>
        </div>
        <p className="text-gray-600">
          Location-aware insights, zone strategies, and profitability tools for your market.
        </p>
      </div>

      {/* Market Context Banner */}
      <Card className={`shadow-lg ${colors.border} overflow-hidden`}>
        <CardContent className={`p-0 bg-gradient-to-r ${colors.bg}`}>
          <div className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Location Info */}
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl bg-white/70 ${colors.text}`}>
                  <Navigation className="w-6 h-6" />
                </div>
                <div>
                  {!isLocationResolved ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                      <span className="text-gray-600">Detecting your market...</span>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-xl font-bold text-gray-900">
                        {city}, {state}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={colors.badge}>
                          {archetypeInfo.name}
                        </Badge>
                        <span className="text-sm text-gray-500">Market</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Market Type Description */}
              <div className="flex-1 max-w-md">
                <p className={`text-sm ${colors.text} leading-relaxed`}>
                  {archetypeInfo.description}
                </p>
              </div>

              {/* Refresh Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={refreshGPS}
                disabled={isUpdating}
                className="shrink-0"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isUpdating ? 'animate-spin' : ''}`} />
                {isUpdating ? 'Updating...' : 'Refresh Location'}
              </Button>
            </div>

            {/* Zone Summary */}
            {zones.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">Available Intel:</span>
                  <ZoneSummary zones={zones} />
                  {strategies.length > 0 && (
                    <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-200 text-xs">
                      🎯 {strategies.length} Strategies
                    </Badge>
                  )}
                  {safety.length > 0 && (
                    <Badge variant="outline" className="bg-rose-100 text-rose-700 border-rose-200 text-xs">
                      🛡️ {safety.length} Safety Tips
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Market Position Card - Shows market anchor, region type, and deadhead risk */}
      {regionType && (
        <Card className="shadow-lg border-indigo-200 overflow-hidden">
          <CardHeader
            className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 cursor-pointer"
            onClick={() => toggleSection('marketPosition')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                Your Market Position
              </CardTitle>
              {expandedSections.marketPosition ? (
                <ChevronUp className="w-5 h-5 text-indigo-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-indigo-600" />
              )}
            </div>
          </CardHeader>
          {expandedSections.marketPosition && (
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Region Type Badge */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Badge
                      className={`text-sm px-3 py-1 ${
                        regionType === 'Core'
                          ? 'bg-green-100 text-green-800 border-green-300'
                          : regionType === 'Satellite'
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : 'bg-red-100 text-red-800 border-red-300'
                      }`}
                    >
                      {regionType === 'Core' && <CheckCircle className="w-3.5 h-3.5 mr-1" />}
                      {regionType === 'Satellite' && <TrendingUp className="w-3.5 h-3.5 mr-1" />}
                      {regionType === 'Rural' && <AlertTriangle className="w-3.5 h-3.5 mr-1" />}
                      {regionType} Market
                    </Badge>
                  </div>

                  {marketAnchor && city !== marketAnchor && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">{city}</span> is a {regionType?.toLowerCase()} city within the{' '}
                      <span className="font-semibold text-indigo-700">{marketAnchor}</span> market.
                    </p>
                  )}

                  {marketAnchor && city === marketAnchor && (
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">{city}</span> is the core anchor of this market.
                    </p>
                  )}

                  {/* Market Stats */}
                  {marketStats && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                        {marketStats.total_cities} cities in market
                      </span>
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded">
                        {marketStats.core_count} core
                      </span>
                      <span className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded">
                        {marketStats.satellite_count} satellite
                      </span>
                      {parseInt(marketStats.rural_count) > 0 && (
                        <span className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded">
                          {marketStats.rural_count} rural
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Deadhead Risk */}
                {deadheadRisk && (
                  <div className={`p-4 rounded-lg ${
                    deadheadRisk.level === 'low'
                      ? 'bg-green-50 border border-green-200'
                      : deadheadRisk.level === 'medium'
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-red-50 border border-red-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Target className={`w-4 h-4 ${
                        deadheadRisk.level === 'low'
                          ? 'text-green-600'
                          : deadheadRisk.level === 'medium'
                          ? 'text-amber-600'
                          : 'text-red-600'
                      }`} />
                      <span className="font-semibold text-gray-900">
                        Deadhead Risk: {deadheadRisk.level.charAt(0).toUpperCase() + deadheadRisk.level.slice(1)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{deadheadRisk.description}</p>
                    <p className="text-sm font-medium text-gray-900">
                      💡 {deadheadRisk.advice}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
          <span className="ml-3 text-gray-600">Loading market intelligence...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-red-700">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load intelligence data. Please try again.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Intelligence Available */}
      {!isLoading && !error && intelligence?.total_items === 0 && (
        <Card className="border-gray-200">
          <CardContent className="p-8 text-center">
            <Globe className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No Intelligence Available Yet
            </h3>
            <p className="text-gray-600 max-w-md mx-auto">
              We're still building intelligence for <strong>{city}</strong>.
              Check back soon, or explore the universal zone logic and calculator below!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Universal Zone Logic (always shown) */}
      <UniversalZoneLogic />

      {/* Strategic Principles */}
      <Card className="shadow-lg border-gray-200">
        <CardHeader
          className="cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => toggleSection('strategies')}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="w-5 h-5 text-gray-600" />
              Strategic Principles
            </CardTitle>
            {expandedSections.strategies ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </div>
        </CardHeader>
        {expandedSections.strategies && (
          <CardContent className="pt-0">
            <StrategicPrinciples recommendedStrategy={archetype} />
          </CardContent>
        )}
      </Card>

      {/* Deadhead Calculator */}
      <div className="space-y-2">
        <div
          className="flex items-center justify-between cursor-pointer p-2 hover:bg-gray-50 rounded-lg transition-colors"
          onClick={() => toggleSection('calculator')}
        >
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">Profitability Tools</h3>
          </div>
          {expandedSections.calculator ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
        {expandedSections.calculator && <DeadheadCalculator />}
      </div>

      {/* Market-Specific Zones */}
      {zones.length > 0 && (
        <Card className="shadow-lg border-emerald-200">
          <CardHeader
            className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 cursor-pointer"
            onClick={() => toggleSection('zones')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="w-5 h-5 text-emerald-600" />
                {city} Zone Intelligence
                <Badge variant="secondary" className="ml-2">{zones.length}</Badge>
              </CardTitle>
              {expandedSections.zones ? (
                <ChevronUp className="w-5 h-5 text-emerald-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-emerald-600" />
              )}
            </div>
          </CardHeader>
          {expandedSections.zones && (
            <CardContent className="p-6">
              <ZoneCards zones={zones} title="" />
            </CardContent>
          )}
        </Card>
      )}

      {/* Market Strategies from API */}
      {strategies.length > 0 && (
        <MarketStrategies strategies={strategies} title={`${city} Strategies`} />
      )}

      {/* Timing Advice */}
      {timing.length > 0 && <TimingAdvice timing={timing} />}

      {/* Safety Information */}
      {safety.length > 0 && (
        <Card className="shadow-lg border-rose-200">
          <CardHeader
            className="bg-gradient-to-r from-rose-50 to-red-50 border-b border-rose-100 cursor-pointer"
            onClick={() => toggleSection('safety')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5 text-rose-600" />
                Safety Information
                <Badge variant="secondary" className="bg-rose-100 text-rose-700 ml-2">
                  {safety.length}
                </Badge>
              </CardTitle>
              {expandedSections.safety ? (
                <ChevronUp className="w-5 h-5 text-rose-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-rose-600" />
              )}
            </div>
          </CardHeader>
          {expandedSections.safety && (
            <CardContent className="p-6">
              <div className="space-y-4">
                {safety.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white border border-rose-100 rounded-lg p-4"
                  >
                    <h4 className="font-semibold text-rose-800">{item.title}</h4>
                    <p className="text-sm text-gray-700 mt-2">{item.content}</p>
                    {item.neighborhoods && item.neighborhoods.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.neighborhoods.map((n, i) => (
                          <span key={i} className="text-xs bg-rose-50 text-rose-700 px-2 py-1 rounded">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Airport Intelligence */}
      {airport.length > 0 && (
        <Card className="shadow-lg border-sky-200">
          <CardHeader
            className="bg-gradient-to-r from-sky-50 to-blue-50 border-b border-sky-100 cursor-pointer"
            onClick={() => toggleSection('airport')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Plane className="w-5 h-5 text-sky-600" />
                Airport Intelligence
                <Badge variant="secondary" className="bg-sky-100 text-sky-700 ml-2">
                  {airport.length}
                </Badge>
              </CardTitle>
              {expandedSections.airport ? (
                <ChevronUp className="w-5 h-5 text-sky-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-sky-600" />
              )}
            </div>
          </CardHeader>
          {expandedSections.airport && (
            <CardContent className="p-6">
              <div className="space-y-4">
                {airport.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white border border-sky-100 rounded-lg p-4"
                  >
                    <h4 className="font-semibold text-sky-800">{item.title}</h4>
                    <p className="text-sm text-gray-700 mt-2">{item.content}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Regulatory Information */}
      {regulatory.length > 0 && (
        <Card className="shadow-lg border-gray-200">
          <CardHeader
            className="cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleSection('regulatory')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-gray-600" />
                Regulatory Context
                <Badge variant="secondary" className="ml-2">{regulatory.length}</Badge>
              </CardTitle>
              {expandedSections.regulatory ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </div>
          </CardHeader>
          {expandedSections.regulatory && (
            <CardContent>
              <div className="space-y-4">
                {regulatory.map((item) => (
                  <div
                    key={item.id}
                    className="bg-gray-50 border border-gray-200 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold text-gray-900">{item.title}</h4>
                      {item.platform !== 'both' && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {item.platform}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-700">{item.content}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Cities in Your Market */}
      {marketCities.length > 1 && (
        <Card className="shadow-lg border-gray-200">
          <CardHeader
            className="cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleSection('marketCities')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="w-5 h-5 text-gray-600" />
                Cities in {marketAnchor || 'Your'} Market
                <Badge variant="secondary" className="ml-2">
                  {marketCities.length} cities
                </Badge>
              </CardTitle>
              {expandedSections.marketCities ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </div>
          </CardHeader>
          {expandedSections.marketCities && (
            <CardContent>
              <p className="text-sm text-gray-500 mb-4">
                These cities share the same rideshare market. Rides between them typically have good return trip opportunities.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {marketCities.map((mc, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded-lg border text-sm ${
                      mc.city === city
                        ? 'bg-indigo-50 border-indigo-300 font-medium'
                        : mc.region_type === 'Core'
                        ? 'bg-green-50 border-green-200'
                        : mc.region_type === 'Satellite'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="font-medium text-gray-900">{mc.city}</div>
                    <div className="text-xs text-gray-500">{mc.region_type || 'Unknown'}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Available Markets */}
      {markets.length > 0 && (
        <Card className="shadow-lg border-gray-200">
          <CardHeader
            className="cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleSection('available')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="w-5 h-5 text-gray-600" />
                Markets with Intelligence
                <Badge variant="secondary" className="ml-2">
                  {markets.length} markets
                </Badge>
              </CardTitle>
              {expandedSections.available ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </div>
          </CardHeader>
          {expandedSections.available && (
            <CardContent>
              {marketsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {markets.map((m, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border transition-colors ${
                        m.market_slug === marketSlug
                          ? 'bg-amber-50 border-amber-300'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-gray-900 text-sm">{m.market}</div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span>{m.intel_count} items</span>
                        {m.zone_count > 0 && <span>• {m.zone_count} zones</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Footer */}
      <div className="text-center text-gray-400 text-xs pt-4">
        Market intelligence powered by VectoPilot. Data for planning purposes only.
      </div>
    </div>
  );
}
