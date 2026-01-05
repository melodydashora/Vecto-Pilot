/**
 * DemandRhythmChart - Weekly Demand Rhythm Visualization
 *
 * Interactive bar chart showing hourly demand patterns by day of week.
 * Uses Recharts via the existing ChartContainer component.
 *
 * Features:
 * - Day-of-week selector (Mon-Sun)
 * - Hourly demand bars (0-23 hours)
 * - Peak period indicators
 * - Strategy insight card per day
 * - Color gradient based on demand intensity
 *
 * Data Sources:
 * - Primary: market_intelligence records with time_context
 * - Fallback: Archetype defaults (sprawl/dense/party)
 *
 * Created: 2026-01-02
 */

import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Clock, TrendingUp, Lightbulb, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import {
  type MarketArchetype,
  type DayOfWeek,
  type DemandPatterns,
  ARCHETYPE_DEMAND_PATTERNS,
  ARCHETYPE_INFO,
  HOUR_LABELS,
  DAY_LABELS,
  DAYS_OF_WEEK,
} from '@/types/demand-patterns';

// ============================================================================
// TYPES
// ============================================================================

interface DemandRhythmChartProps {
  archetype: MarketArchetype;
  marketSlug?: string;
  city?: string;
  /** Market-specific patterns if available (from API) */
  marketPatterns?: DemandPatterns;
}

interface HourlyDataPoint {
  hour: string;
  hourIndex: number;
  demand: number;
  label: string;
}

// ============================================================================
// CHART CONFIGURATION
// ============================================================================

const chartConfig = {
  demand: {
    label: 'Demand Level',
    color: '#10B981', // Default emerald - overridden by cell fill
  },
} satisfies ChartConfig;

/**
 * Get color based on demand intensity (0-100)
 */
function getDemandColor(value: number): string {
  if (value >= 90) return '#ef4444'; // red-500 (fire)
  if (value >= 70) return '#f97316'; // orange-500 (hot)
  if (value >= 50) return '#eab308'; // yellow-500 (warm)
  if (value >= 30) return '#22c55e'; // green-500 (moderate)
  return '#64748b'; // slate-500 (cool)
}

/**
 * Get demand level label
 */
function getDemandLevel(value: number): string {
  if (value >= 90) return 'Peak';
  if (value >= 70) return 'High';
  if (value >= 50) return 'Moderate';
  if (value >= 30) return 'Low';
  return 'Very Low';
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DemandRhythmChart({
  archetype,
  marketSlug,
  city,
  marketPatterns,
}: DemandRhythmChartProps) {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() => {
    // Default to current day
    const today = new Date().getDay();
    const dayMap: Record<number, DayOfWeek> = {
      0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
    };
    return dayMap[today] || 'Mon';
  });
  const [expanded, setExpanded] = useState(true);

  // Use market patterns if available, otherwise use archetype defaults
  // Fallback to 'sprawl' if archetype is invalid
  const safeArchetype = ARCHETYPE_DEMAND_PATTERNS[archetype] ? archetype : 'sprawl';

  const patterns = useMemo(() => {
    return marketPatterns || ARCHETYPE_DEMAND_PATTERNS[safeArchetype];
  }, [marketPatterns, safeArchetype]);

  // Get current day's data - fallback to Monday if selectedDay is invalid
  const dayData = patterns[selectedDay] || patterns.Mon;
  const archetypeInfo = ARCHETYPE_INFO[safeArchetype] || ARCHETYPE_INFO.sprawl;

  // Transform hourly data for chart
  const chartData: HourlyDataPoint[] = useMemo(() => {
    return dayData.hours.map((demand, index) => ({
      hour: HOUR_LABELS[index],
      hourIndex: index,
      demand,
      label: getDemandLevel(demand),
    }));
  }, [dayData.hours]);

  // Calculate peak hour
  const peakHourIndex = dayData.hours.indexOf(Math.max(...dayData.hours));
  const peakHour = HOUR_LABELS[peakHourIndex];

  // Check if it's a weekend
  const isWeekend = selectedDay === 'Sat' || selectedDay === 'Sun';

  // Check if this day is a peak day for the archetype
  const isPeakDay = archetypeInfo.peakDays.includes(selectedDay);

  return (
    <Card className="shadow-lg border-indigo-200 overflow-hidden">
      <CardHeader
        className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            <div>
              <CardTitle className="text-lg">Demand Rhythm</CardTitle>
              <span className="text-xs text-gray-500 font-normal">
                {city ? `${city} Market` : 'Your Market'} • {archetypeInfo.icon} {archetypeInfo.name}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPeakDay && (
              <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                🔥 Peak Day
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="w-5 h-5 text-indigo-600" />
            ) : (
              <ChevronDown className="w-5 h-5 text-indigo-600" />
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {/* Day Selector */}
          <div className="p-4 bg-white border-b border-gray-100">
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const isSelected = day === selectedDay;
                const dayIsPeak = archetypeInfo.peakDays.includes(day);
                return (
                  <Button
                    key={day}
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedDay(day)}
                    className={`relative ${
                      isSelected
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'hover:bg-indigo-50'
                    }`}
                  >
                    {day}
                    {dayIsPeak && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
                    )}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          <div className="p-4">
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="hour"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  interval={2}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                />
                <ChartTooltip
                  cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => `${value}`}
                      formatter={(value, name) => (
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: getDemandColor(value as number) }}
                          />
                          <span className="font-medium">{getDemandLevel(value as number)}</span>
                          <span className="text-gray-500">({value}%)</span>
                        </div>
                      )}
                    />
                  }
                />
                {/* Reference line at 70% (high demand threshold) */}
                <ReferenceLine
                  y={70}
                  stroke="#f97316"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
                <Bar
                  dataKey="demand"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getDemandColor(entry.demand)}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>

            {/* Chart Legend */}
            <div className="flex justify-center gap-4 mt-2 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                Very Low
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Low
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                Moderate
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                High
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Peak
              </span>
            </div>
          </div>

          {/* Insight Card */}
          <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-t border-indigo-100">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Lightbulb className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold text-gray-900">
                    {DAY_LABELS[selectedDay]} Strategy
                  </h4>
                  <Badge variant="outline" className="text-xs">
                    Peak: {peakHour}
                  </Badge>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {dayData.insight}
                </p>

                {/* Peak Periods & Zones */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {dayData.peakPeriods?.map((period, idx) => (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="bg-orange-50 text-orange-700 border-orange-200 text-xs"
                    >
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {period}
                    </Badge>
                  ))}
                  {dayData.recommendedZones?.slice(0, 3).map((zone, idx) => (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                    >
                      <MapPin className="w-3 h-3 mr-1" />
                      {zone}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Data Source Indicator */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 text-center">
            {marketPatterns ? (
              <span>📊 Market-specific data for {city || marketSlug}</span>
            ) : (
              <span>📈 {archetypeInfo.name} archetype patterns</span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default DemandRhythmChart;
