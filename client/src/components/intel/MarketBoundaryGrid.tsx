/**
 * MarketBoundaryGrid - Market Zone Visualization
 *
 * CSS grid visualization showing Core/Satellite/Rural zones for the user's market.
 * Displays cities grouped by region_type from platform_data table.
 *
 * Features:
 * - Concentric zone visualization (Core → Satellite → Rural)
 * - Current city highlight with pulsing indicator
 * - Market statistics banner
 * - Deadhead risk indicators per zone
 * - Responsive grid layout
 *
 * Data Sources:
 * - Primary: market_cities from /api/intelligence/lookup
 * - Fallback: Shows "No market data" state
 *
 * Created: 2026-01-02
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Map,
  Target,
  AlertTriangle,
  MapPin,
  ChevronDown,
  ChevronUp,
  Building2,
  Mountain,
  TreePine,
  Zap,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

export type RegionType = 'Core' | 'Satellite' | 'Rural';

export interface MarketCity {
  city: string;
  region: string;
  region_type: string;
}

export interface MarketStats {
  total_cities: string;
  core_count: string;
  satellite_count: string;
  rural_count: string;
}

interface MarketBoundaryGridProps {
  currentCity: string | null;
  marketAnchor: string | null;
  regionType: RegionType | null;
  marketCities: MarketCity[];
  marketStats: MarketStats | null;
  isLoading?: boolean;
}

// ============================================================================
// ZONE CONFIGURATION
// ============================================================================

interface ZoneConfig {
  name: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  icon: typeof Building2;
  bgColor: string;
  borderColor: string;
  textColor: string;
  badgeColor: string;
  riskLabel: string;
  advice: string;
}

const ZONE_CONFIG: Record<RegionType, ZoneConfig> = {
  Core: {
    name: 'Core Zone',
    description: 'High demand, short deadhead, optimal positioning',
    risk: 'low',
    icon: Building2,
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
    textColor: 'text-emerald-700',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    riskLabel: 'Safe Zone',
    advice: 'Stay here. Highest ride density, minimal deadhead risk.',
  },
  Satellite: {
    name: 'Satellite Zone',
    description: 'Moderate demand, acceptable for surge chasing',
    risk: 'medium',
    icon: Mountain,
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
    textColor: 'text-amber-700',
    badgeColor: 'bg-amber-100 text-amber-700 border-amber-300',
    riskLabel: 'Caution Zone',
    advice: 'Worth it for surge. Plan return trip to Core.',
  },
  Rural: {
    name: 'Rural Zone',
    description: 'Low demand, high deadhead risk',
    risk: 'high',
    icon: TreePine,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-300',
    textColor: 'text-red-700',
    badgeColor: 'bg-red-100 text-red-700 border-red-300',
    riskLabel: 'Danger Zone',
    advice: 'Avoid unless surge is 2x+. Long deadhead back.',
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function groupCitiesByRegion(cities: MarketCity[]): Record<RegionType, string[]> {
  const grouped: Record<RegionType, string[]> = {
    Core: [],
    Satellite: [],
    Rural: [],
  };

  cities.forEach((city) => {
    const regionType = city.region_type as RegionType;
    if (grouped[regionType]) {
      grouped[regionType].push(city.city);
    }
  });

  // Sort each group alphabetically
  Object.keys(grouped).forEach((key) => {
    grouped[key as RegionType].sort();
  });

  return grouped;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MarketBoundaryGrid({
  currentCity,
  marketAnchor,
  regionType,
  marketCities,
  marketStats,
  isLoading,
}: MarketBoundaryGridProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedZone, setSelectedZone] = useState<RegionType | null>(null);

  // Group cities by region type
  const groupedCities = useMemo(() => {
    return groupCitiesByRegion(marketCities);
  }, [marketCities]);

  // Calculate percentages for visualization
  const zonePercentages = useMemo(() => {
    if (!marketStats) return { Core: 33, Satellite: 33, Rural: 34 };

    const total = parseInt(marketStats.total_cities) || 1;
    return {
      Core: Math.round((parseInt(marketStats.core_count) / total) * 100),
      Satellite: Math.round((parseInt(marketStats.satellite_count) / total) * 100),
      Rural: Math.round((parseInt(marketStats.rural_count) / total) * 100),
    };
  }, [marketStats]);

  // Current zone config
  const currentZoneConfig = regionType ? ZONE_CONFIG[regionType] : null;

  // No data state
  if (!marketCities.length && !isLoading) {
    return (
      <Card className="shadow-lg border-slate-200">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Map className="w-5 h-5 text-slate-600" />
            <CardTitle className="text-lg">Market Zones</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 text-center text-gray-500">
          <MapPin className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No market zone data available for your location.</p>
          <p className="text-sm mt-1">Market structure data is being collected.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg border-slate-200 overflow-hidden">
      <CardHeader
        className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-slate-100 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Map className="w-5 h-5 text-slate-600" />
            <div>
              <CardTitle className="text-lg">Market Zones</CardTitle>
              <span className="text-xs text-gray-500 font-normal">
                {marketAnchor || currentCity} Metro • {marketStats?.total_cities || '?'} Cities
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentZoneConfig && (
              <Badge className={currentZoneConfig.badgeColor}>
                {currentZoneConfig.riskLabel}
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="w-5 h-5 text-slate-600" />
            ) : (
              <ChevronDown className="w-5 h-5 text-slate-600" />
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {/* Current Position Banner */}
          {currentCity && regionType && (
            <div className={`px-4 py-3 ${ZONE_CONFIG[regionType].bgColor} border-b ${ZONE_CONFIG[regionType].borderColor}`}>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Target className={`w-5 h-5 ${ZONE_CONFIG[regionType].textColor}`} />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${ZONE_CONFIG[regionType].textColor}`}>
                      You're in {currentCity}
                    </span>
                    <Badge variant="outline" className={`text-xs ${ZONE_CONFIG[regionType].badgeColor}`}>
                      {regionType}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {ZONE_CONFIG[regionType].advice}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Zone Breakdown Bar */}
          <div className="px-4 py-3 bg-white border-b border-gray-100">
            <div className="flex h-3 rounded-full overflow-hidden shadow-inner bg-gray-100">
              <div
                className="bg-emerald-500 transition-all duration-500"
                style={{ width: `${zonePercentages.Core}%` }}
                title={`Core: ${zonePercentages.Core}%`}
              />
              <div
                className="bg-amber-500 transition-all duration-500"
                style={{ width: `${zonePercentages.Satellite}%` }}
                title={`Satellite: ${zonePercentages.Satellite}%`}
              />
              <div
                className="bg-red-500 transition-all duration-500"
                style={{ width: `${zonePercentages.Rural}%` }}
                title={`Rural: ${zonePercentages.Rural}%`}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Core ({marketStats?.core_count || 0})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Satellite ({marketStats?.satellite_count || 0})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Rural ({marketStats?.rural_count || 0})
              </span>
            </div>
          </div>

          {/* Zone Selection Tabs */}
          <div className="p-4 bg-white border-b border-gray-100">
            <div className="flex gap-2">
              {(['Core', 'Satellite', 'Rural'] as RegionType[]).map((zone) => {
                const config = ZONE_CONFIG[zone];
                const isSelected = selectedZone === zone;
                const isCurrentZone = zone === regionType;
                const ZoneIcon = config.icon;

                return (
                  <Button
                    key={zone}
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedZone(isSelected ? null : zone)}
                    className={`flex-1 relative ${
                      isSelected
                        ? `${config.bgColor} ${config.textColor} border-2 ${config.borderColor} hover:${config.bgColor}`
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <ZoneIcon className="w-4 h-4 mr-1" />
                    {zone}
                    {isCurrentZone && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Zone Detail Panel */}
          {selectedZone && (
            <div className={`p-4 ${ZONE_CONFIG[selectedZone].bgColor} border-b ${ZONE_CONFIG[selectedZone].borderColor}`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${ZONE_CONFIG[selectedZone].borderColor} border bg-white`}>
                  {(() => {
                    const ZoneIcon = ZONE_CONFIG[selectedZone].icon;
                    return <ZoneIcon className={`w-5 h-5 ${ZONE_CONFIG[selectedZone].textColor}`} />;
                  })()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className={`font-bold ${ZONE_CONFIG[selectedZone].textColor}`}>
                      {ZONE_CONFIG[selectedZone].name}
                    </h4>
                    <Badge className={ZONE_CONFIG[selectedZone].badgeColor}>
                      {ZONE_CONFIG[selectedZone].risk === 'low' && '✅ Low Risk'}
                      {ZONE_CONFIG[selectedZone].risk === 'medium' && '⚠️ Medium Risk'}
                      {ZONE_CONFIG[selectedZone].risk === 'high' && '🚨 High Risk'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">
                    {ZONE_CONFIG[selectedZone].description}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <Zap className="w-3 h-3" />
                    <span className="font-medium">Strategy:</span>
                    <span>{ZONE_CONFIG[selectedZone].advice}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Cities Grid */}
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['Core', 'Satellite', 'Rural'] as RegionType[]).map((zone) => {
                const config = ZONE_CONFIG[zone];
                const cities = groupedCities[zone];
                const ZoneIcon = config.icon;

                return (
                  <div
                    key={zone}
                    className={`rounded-lg border-2 ${config.borderColor} ${config.bgColor} p-3 transition-all ${
                      selectedZone === zone ? 'ring-2 ring-offset-2 ring-slate-400' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <ZoneIcon className={`w-4 h-4 ${config.textColor}`} />
                      <span className={`font-semibold text-sm ${config.textColor}`}>
                        {zone}
                      </span>
                      <Badge variant="outline" className="text-xs ml-auto">
                        {cities.length}
                      </Badge>
                    </div>

                    {cities.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {cities.slice(0, 10).map((city) => {
                          const isCurrentCity = city.toLowerCase() === currentCity?.toLowerCase();
                          return (
                            <Badge
                              key={city}
                              variant="outline"
                              className={`text-xs ${
                                isCurrentCity
                                  ? 'bg-white border-green-500 text-green-700 font-bold shadow-sm'
                                  : 'bg-white/50 border-gray-200 text-gray-600'
                              }`}
                            >
                              {isCurrentCity && <MapPin className="w-3 h-3 mr-1" />}
                              {city}
                            </Badge>
                          );
                        })}
                        {cities.length > 10 && (
                          <Badge variant="outline" className="text-xs bg-white/50 text-gray-500">
                            +{cities.length - 10} more
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No cities in this zone</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Deadhead Risk Matrix */}
          <div className="px-4 pb-4">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-gray-500" />
                <span className="font-semibold text-sm text-gray-700">Deadhead Risk Matrix</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-xs">
                <div className="font-medium text-gray-500">From / To</div>
                <div className="font-medium text-center text-emerald-600">Core</div>
                <div className="font-medium text-center text-amber-600">Satellite</div>
                <div className="font-medium text-center text-red-600">Rural</div>

                <div className="font-medium text-emerald-600">Core</div>
                <div className="text-center bg-emerald-100 rounded px-1 py-0.5">✅ Low</div>
                <div className="text-center bg-amber-100 rounded px-1 py-0.5">⚠️ Med</div>
                <div className="text-center bg-red-100 rounded px-1 py-0.5">🚨 High</div>

                <div className="font-medium text-amber-600">Satellite</div>
                <div className="text-center bg-emerald-100 rounded px-1 py-0.5">✅ Low</div>
                <div className="text-center bg-amber-100 rounded px-1 py-0.5">⚠️ Med</div>
                <div className="text-center bg-red-100 rounded px-1 py-0.5">🚨 High</div>

                <div className="font-medium text-red-600">Rural</div>
                <div className="text-center bg-amber-100 rounded px-1 py-0.5">⚠️ Med</div>
                <div className="text-center bg-red-100 rounded px-1 py-0.5">🚨 High</div>
                <div className="text-center bg-red-200 rounded px-1 py-0.5">❌ Avoid</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 text-center">
            🗺️ Market zones based on {marketAnchor || currentCity} metro area structure
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default MarketBoundaryGrid;
