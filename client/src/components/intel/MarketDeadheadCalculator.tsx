/**
 * MarketDeadheadCalculator - Market-Specific Deadhead Risk Calculator
 *
 * Unlike the universal DeadheadCalculator which uses generic destination types,
 * this calculator uses ACTUAL cities from the user's market with their
 * region_type (Core/Satellite/Rural) to calculate precise deadhead risk.
 *
 * Features:
 * - Dropdown with real cities from market_cities
 * - Risk based on region_type transitions
 * - Visual risk indicator with color gradient
 * - Context-aware advice based on zone changes
 * - Current position auto-highlighted
 *
 * Data Sources:
 * - market_cities from /api/intelligence/lookup
 * - calculateDeadheadRisk from demand-patterns.ts
 *
 * Created: 2026-01-02
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Navigation,
  MapPin,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Clock,
  ChevronDown,
  ChevronUp,
  Route,
  Zap,
} from 'lucide-react';
import { type RegionType, calculateDeadheadRisk, type DeadheadRiskLevel } from '@/types/demand-patterns';

// ============================================================================
// TYPES
// ============================================================================

export interface MarketCity {
  city: string;
  region: string;
  region_type: string;
}

interface MarketDeadheadCalculatorProps {
  currentCity: string | null;
  currentRegionType: RegionType | null;
  marketCities: MarketCity[];
  marketAnchor: string | null;
}

interface RiskResult {
  level: DeadheadRiskLevel;
  fromCity: string;
  fromRegion: RegionType;
  toCity: string;
  toRegion: RegionType;
  advice: string;
  surgeRequired: string;
  timeEstimate: string;
}

// ============================================================================
// RISK CONFIGURATION
// ============================================================================

interface RiskConfig {
  icon: typeof CheckCircle2;
  emoji: string;
  title: string;
  color: string;
  bgColor: string;
  borderColor: string;
  ringColor: string;
}

const RISK_CONFIG: Record<DeadheadRiskLevel, RiskConfig> = {
  low: {
    icon: CheckCircle2,
    emoji: '✅',
    title: 'LOW RISK',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
    ringColor: 'ring-emerald-400',
  },
  medium: {
    icon: AlertTriangle,
    emoji: '⚠️',
    title: 'MEDIUM RISK',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
    ringColor: 'ring-amber-400',
  },
  high: {
    icon: XCircle,
    emoji: '🚨',
    title: 'HIGH RISK',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-300',
    ringColor: 'ring-red-400',
  },
  extreme: {
    icon: XCircle,
    emoji: '❌',
    title: 'EXTREME RISK',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-400',
    ringColor: 'ring-red-500',
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getAdvice(fromRegion: RegionType, toRegion: RegionType): string {
  if (fromRegion === 'Core' && toRegion === 'Core') {
    return 'Staying in Core. Optimal positioning - accept this trip.';
  }
  if (fromRegion === 'Core' && toRegion === 'Satellite') {
    return 'Leaving Core for Satellite. Worth it for surge, otherwise stay.';
  }
  if (fromRegion === 'Core' && toRegion === 'Rural') {
    return 'Core to Rural is dangerous! Only accept with 2x+ surge.';
  }
  if (fromRegion === 'Satellite' && toRegion === 'Core') {
    return 'Great trip! Moving toward Core increases ride density.';
  }
  if (fromRegion === 'Satellite' && toRegion === 'Satellite') {
    return 'Satellite to Satellite. Acceptable but watch for Core opportunities.';
  }
  if (fromRegion === 'Satellite' && toRegion === 'Rural') {
    return 'Satellite to Rural is risky. Long deadhead back. Needs surge.';
  }
  if (fromRegion === 'Rural' && toRegion === 'Core') {
    return 'Excellent! Getting back to civilization. Accept this trip.';
  }
  if (fromRegion === 'Rural' && toRegion === 'Satellite') {
    return 'Better than staying Rural. Accept to get closer to Core.';
  }
  if (fromRegion === 'Rural' && toRegion === 'Rural') {
    return 'Rural to Rural? Turn around and go home. Do not accept.';
  }
  return 'Evaluate based on current conditions.';
}

function getSurgeRequired(level: DeadheadRiskLevel): string {
  switch (level) {
    case 'low': return 'Any fare OK';
    case 'medium': return '1.5x+ recommended';
    case 'high': return '2x+ required';
    case 'extreme': return 'Decline unless 3x+';
  }
}

function getTimeEstimate(fromRegion: RegionType, toRegion: RegionType): string {
  // Estimated deadhead time based on zone transition
  const estimates: Record<string, string> = {
    'Core-Core': '< 5 min',
    'Core-Satellite': '10-20 min',
    'Core-Rural': '25-45 min',
    'Satellite-Core': '10-20 min',
    'Satellite-Satellite': '15-25 min',
    'Satellite-Rural': '20-35 min',
    'Rural-Core': '25-45 min',
    'Rural-Satellite': '20-35 min',
    'Rural-Rural': '30+ min',
  };
  return estimates[`${fromRegion}-${toRegion}`] || '15-30 min';
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MarketDeadheadCalculator({
  currentCity,
  currentRegionType: _currentRegionType,
  marketCities,
  marketAnchor,
}: MarketDeadheadCalculatorProps) {
  const [expanded, setExpanded] = useState(true);
  const [fromCity, setFromCity] = useState<string>(currentCity || '');
  const [toCity, setToCity] = useState<string>('');
  const [result, setResult] = useState<RiskResult | null>(null);

  // Group cities by region type for select options
  const citiesByRegion = useMemo(() => {
    const grouped: Record<RegionType, MarketCity[]> = {
      Core: [],
      Satellite: [],
      Rural: [],
    };

    marketCities.forEach((city) => {
      const regionType = city.region_type as RegionType;
      if (grouped[regionType]) {
        grouped[regionType].push(city);
      }
    });

    // Sort each group alphabetically
    Object.keys(grouped).forEach((key) => {
      grouped[key as RegionType].sort((a, b) => a.city.localeCompare(b.city));
    });

    return grouped;
  }, [marketCities]);

  // Get region type for a city
  const getRegionType = (cityName: string): RegionType | null => {
    const found = marketCities.find(
      (c) => c.city.toLowerCase() === cityName.toLowerCase()
    );
    return found ? (found.region_type as RegionType) : null;
  };

  // Calculate risk when button clicked
  const handleCalculate = () => {
    const fromRegion = getRegionType(fromCity);
    const toRegion = getRegionType(toCity);

    if (!fromRegion || !toRegion) {
      return;
    }

    const level = calculateDeadheadRisk(fromRegion, toRegion);

    setResult({
      level,
      fromCity,
      fromRegion,
      toCity,
      toRegion,
      advice: getAdvice(fromRegion, toRegion),
      surgeRequired: getSurgeRequired(level),
      timeEstimate: getTimeEstimate(fromRegion, toRegion),
    });
  };

  // Reset when from city changes
  const handleFromCityChange = (value: string) => {
    setFromCity(value);
    setResult(null);
  };

  // Reset when to city changes
  const handleToCityChange = (value: string) => {
    setToCity(value);
    setResult(null);
  };

  // Use current location
  const useCurrentLocation = () => {
    if (currentCity) {
      setFromCity(currentCity);
      setResult(null);
    }
  };

  const resultConfig = result ? RISK_CONFIG[result.level] : null;

  // No data state
  if (marketCities.length === 0) {
    return (
      <Card className="shadow-lg border-gray-200">
        <CardHeader className="bg-gradient-to-r from-gray-900 to-gray-800 text-white">
          <div className="flex items-center gap-2">
            <Route className="w-5 h-5" />
            <CardTitle className="text-lg">Market Deadhead Calculator</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 text-center text-gray-500">
          <Navigation className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No market cities available.</p>
          <p className="text-sm mt-1">Market data is being collected.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-gray-200 overflow-hidden">
      <CardHeader
        className="bg-gradient-to-r from-gray-900 to-gray-800 text-white cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Route className="w-5 h-5" />
              Market Deadhead Calculator
            </CardTitle>
            <p className="text-gray-400 text-sm mt-1">
              {marketAnchor || currentCity} Metro • {marketCities.length} Cities
            </p>
          </div>
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
            {/* Input Panel */}
            <div className="p-5 space-y-5">
              {/* From City */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase">
                    <MapPin className="w-4 h-4 text-emerald-500" />
                    From (Origin)
                  </label>
                  {currentCity && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={useCurrentLocation}
                      className="text-xs text-indigo-600 hover:text-indigo-700 h-auto py-1 px-2"
                    >
                      <Navigation className="w-3 h-3 mr-1" />
                      Use Current
                    </Button>
                  )}
                </div>
                <Select value={fromCity} onValueChange={handleFromCityChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select origin city..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {(['Core', 'Satellite', 'Rural'] as RegionType[])
                      .filter((region) => citiesByRegion[region].length > 0)
                      .map((region) => (
                        <div key={region}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">
                            {region === 'Core' && '🟢'}
                            {region === 'Satellite' && '🟡'}
                            {region === 'Rural' && '🔴'} {region} Zone
                          </div>
                          {citiesByRegion[region].map((city) => (
                            <SelectItem key={city.city} value={city.city}>
                              <span className="flex items-center gap-2">
                                {city.city}
                                {city.city.toLowerCase() === currentCity?.toLowerCase() && (
                                  <Badge variant="outline" className="text-xs scale-75 bg-green-50 text-green-700 border-green-300">
                                    You
                                  </Badge>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                  </SelectContent>
                </Select>
                {fromCity && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        getRegionType(fromCity) === 'Core'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : getRegionType(fromCity) === 'Satellite'
                          ? 'bg-amber-50 text-amber-700 border-amber-300'
                          : 'bg-red-50 text-red-700 border-red-300'
                      }`}
                    >
                      {getRegionType(fromCity)}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <div className="flex items-center gap-2 text-gray-400">
                  <div className="h-px w-8 bg-gray-200" />
                  <ArrowRight className="w-5 h-5" />
                  <div className="h-px w-8 bg-gray-200" />
                </div>
              </div>

              {/* To City */}
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase mb-2">
                  <MapPin className="w-4 h-4 text-red-500" />
                  To (Destination)
                </label>
                <Select value={toCity} onValueChange={handleToCityChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select destination city..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {(['Core', 'Satellite', 'Rural'] as RegionType[])
                      .filter((region) => citiesByRegion[region].length > 0)
                      .map((region) => (
                        <div key={region}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">
                            {region === 'Core' && '🟢'}
                            {region === 'Satellite' && '🟡'}
                            {region === 'Rural' && '🔴'} {region} Zone
                          </div>
                          {citiesByRegion[region].map((city) => (
                            <SelectItem key={city.city} value={city.city}>
                              {city.city}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                  </SelectContent>
                </Select>
                {toCity && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        getRegionType(toCity) === 'Core'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : getRegionType(toCity) === 'Satellite'
                          ? 'bg-amber-50 text-amber-700 border-amber-300'
                          : 'bg-red-50 text-red-700 border-red-300'
                      }`}
                    >
                      {getRegionType(toCity)}
                    </Badge>
                  </div>
                )}
              </div>

              <Button
                onClick={handleCalculate}
                disabled={!fromCity || !toCity}
                className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-4 shadow-lg disabled:opacity-50"
              >
                <Zap className="w-4 h-4 mr-2" />
                Calculate Deadhead Risk
              </Button>
            </div>

            {/* Result Panel */}
            <div className="p-5 bg-gray-50 flex items-center justify-center min-h-[340px]">
              {!result ? (
                <div className="text-center text-gray-400">
                  <span className="text-4xl block mb-2">📍</span>
                  <p className="font-medium">Select origin & destination</p>
                  <p className="text-sm">to calculate deadhead risk</p>
                </div>
              ) : (
                <div
                  className={`w-full h-full flex flex-col justify-between p-4 rounded-xl ${resultConfig?.bgColor} border-2 ${resultConfig?.borderColor} animate-in fade-in slide-in-from-right-2 duration-300`}
                >
                  {/* Verdict Header */}
                  <div className="text-center mb-4">
                    <span className="text-4xl block mb-1">{resultConfig?.emoji}</span>
                    <h4 className={`text-2xl font-black ${resultConfig?.color}`}>
                      {resultConfig?.title}
                    </h4>
                  </div>

                  {/* Route Display */}
                  <div className="bg-white/60 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-center">
                        <Badge
                          variant="outline"
                          className={`mb-1 ${
                            result.fromRegion === 'Core'
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                              : result.fromRegion === 'Satellite'
                              ? 'bg-amber-100 text-amber-700 border-amber-300'
                              : 'bg-red-100 text-red-700 border-red-300'
                          }`}
                        >
                          {result.fromRegion}
                        </Badge>
                        <p className="font-semibold text-gray-800">{result.fromCity}</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0 mx-2" />
                      <div className="text-center">
                        <Badge
                          variant="outline"
                          className={`mb-1 ${
                            result.toRegion === 'Core'
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                              : result.toRegion === 'Satellite'
                              ? 'bg-amber-100 text-amber-700 border-amber-300'
                              : 'bg-red-100 text-red-700 border-red-300'
                          }`}
                        >
                          {result.toRegion}
                        </Badge>
                        <p className="font-semibold text-gray-800">{result.toCity}</p>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="space-y-2 bg-white/50 p-3 rounded-lg mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        Est. Deadhead
                      </span>
                      <span className="font-bold text-gray-800">{result.timeEstimate}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" />
                        Surge Needed
                      </span>
                      <span className="font-bold text-gray-800">{result.surgeRequired}</span>
                    </div>
                  </div>

                  {/* Advice */}
                  <div className="bg-white/70 rounded-lg p-3">
                    <p className="text-sm text-gray-700 leading-relaxed text-center">
                      💡 {result.advice}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Reference Footer */}
          <div className="px-4 py-3 bg-gray-100 border-t border-gray-200">
            <div className="flex justify-between items-center text-xs text-gray-500">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Core = Safe
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Satellite = Caution
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Rural = Danger
              </span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default MarketDeadheadCalculator;
