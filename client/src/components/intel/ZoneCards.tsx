/**
 * ZoneCards Component
 *
 * Displays market zone intelligence as interactive cards.
 * Each zone type has a distinct visual style:
 * - Honey Holes: Green (profitable areas)
 * - Danger Zones: Red (safety risks)
 * - Dead Zones: Gray (low demand)
 * - Safe Corridors: Blue (recommended routes)
 * - Caution Zones: Amber (areas requiring awareness)
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, MapPin, AlertTriangle, Skull, Shield, AlertCircle } from 'lucide-react';
import type { IntelligenceItem, ZoneSubtype } from '@/hooks/useMarketIntelligence';

interface ZoneCardsProps {
  zones: IntelligenceItem[];
  title?: string;
  showEmpty?: boolean;
}

// Zone type configuration
const ZONE_CONFIG: Record<ZoneSubtype, {
  label: string;
  icon: React.ReactNode;
  emoji: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  badgeColor: string;
  description: string;
}> = {
  honey_hole: {
    label: 'Honey Hole',
    icon: <MapPin className="w-5 h-5" />,
    emoji: '🍯',
    bgColor: 'bg-emerald-50',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-200',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    description: 'High-demand, profitable areas'
  },
  danger_zone: {
    label: 'Danger Zone',
    icon: <AlertTriangle className="w-5 h-5" />,
    emoji: '⚠️',
    bgColor: 'bg-rose-50',
    textColor: 'text-rose-700',
    borderColor: 'border-rose-200',
    badgeColor: 'bg-rose-100 text-rose-700 border-rose-200',
    description: 'Safety risk areas'
  },
  dead_zone: {
    label: 'Dead Zone',
    icon: <Skull className="w-5 h-5" />,
    emoji: '🏜️',
    bgColor: 'bg-gray-50',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-200',
    badgeColor: 'bg-gray-100 text-gray-700 border-gray-200',
    description: 'Low-demand areas to avoid'
  },
  safe_corridor: {
    label: 'Safe Corridor',
    icon: <Shield className="w-5 h-5" />,
    emoji: '🛡️',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
    description: 'Recommended safe routes'
  },
  caution_zone: {
    label: 'Caution Zone',
    icon: <AlertCircle className="w-5 h-5" />,
    emoji: '⚡',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-200',
    badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
    description: 'Areas requiring awareness'
  }
};

// Single zone card component
function ZoneCard({ zone }: { zone: IntelligenceItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = ZONE_CONFIG[zone.intel_subtype as ZoneSubtype] || ZONE_CONFIG.caution_zone;

  return (
    <div
      className={`group cursor-pointer ${config.bgColor} border ${config.borderColor} rounded-xl p-4 transition-all duration-200 hover:shadow-md`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="text-2xl group-hover:scale-110 transition-transform duration-200">
            {config.emoji}
          </span>
          <div>
            <h4 className={`font-bold ${config.textColor}`}>{zone.title}</h4>
            <Badge variant="outline" className={`mt-1 text-xs ${config.badgeColor}`}>
              {config.label}
            </Badge>
          </div>
        </div>
        <div className={config.textColor}>
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </div>

      {zone.summary && !expanded && (
        <p className="text-sm text-gray-600 mt-3 line-clamp-2">{zone.summary}</p>
      )}

      {expanded && (
        <div className="mt-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
          <p className="text-sm text-gray-700 leading-relaxed">{zone.content}</p>

          {zone.neighborhoods && zone.neighborhoods.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {zone.neighborhoods.map((n, i) => (
                <span key={i} className="text-xs bg-white/50 px-2 py-1 rounded-full border border-gray-200">
                  {n}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-200/50 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              Priority: <strong className={config.textColor}>{zone.priority}%</strong>
            </span>
            <span className="flex items-center gap-1">
              Confidence: <strong>{zone.confidence}%</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Grid of zone cards grouped by type
export function ZoneCards({ zones, title = 'Market Zones', showEmpty = false }: ZoneCardsProps) {
  if (zones.length === 0 && !showEmpty) {
    return null;
  }

  return (
    <div className="space-y-6">
      {title && (
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-amber-600" />
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <Badge variant="secondary" className="ml-2">
            {zones.length} zones
          </Badge>
        </div>
      )}

      {zones.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p>No zone intelligence available for this market yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {zones
            .sort((a, b) => b.priority - a.priority)
            .map((zone) => (
              <ZoneCard key={zone.id} zone={zone} />
            ))}
        </div>
      )}
    </div>
  );
}

// Compact zone summary for header display
export function ZoneSummary({ zones }: { zones: IntelligenceItem[] }) {
  const counts = zones.reduce((acc, zone) => {
    const subtype = zone.intel_subtype as ZoneSubtype;
    acc[subtype] = (acc[subtype] || 0) + 1;
    return acc;
  }, {} as Record<ZoneSubtype, number>);

  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(counts).map(([subtype, count]) => {
        const config = ZONE_CONFIG[subtype as ZoneSubtype];
        return (
          <Badge key={subtype} variant="outline" className={`${config.badgeColor} text-xs`}>
            {config.emoji} {count} {config.label}{count > 1 ? 's' : ''}
          </Badge>
        );
      })}
    </div>
  );
}

// Universal zone logic cards (from sample code inspiration)
export function UniversalZoneLogic() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const universalZones = [
    {
      id: 'suburb',
      title: 'The Wealthy Suburbs',
      emoji: '🏡',
      examples: 'Frisco, Santa Monica, Greenwich, Naperville',
      bestTime: '4:00 AM - 8:00 AM',
      bestTimeColor: 'text-emerald-600',
      goal: 'Catch the "Unicorn" airport run (45+ mins).',
      rule: 'Do not drive here mid-day or evening. You will wait 20 mins for a $5 grocery store run. If you end up here after 9am, set a Destination Filter back to the Core immediately.',
    },
    {
      id: 'core',
      title: 'The Business Core',
      emoji: '🏙️',
      examples: 'Downtown, Financial District, Tech Hubs',
      bestTime: 'Weekdays 7AM-7PM & Weekend Nights',
      bestTimeColor: 'text-blue-600',
      goal: 'Volume. Short, fast trips.',
      rule: 'Know your one-way streets. Avoid during massive events unless surge is >$10. This is where you grind out ride counts for bonuses.',
    },
    {
      id: 'airport',
      title: 'The Airport Hub',
      emoji: '✈️',
      examples: 'Major International Hubs',
      bestTime: 'Sunday PM (Arrivals) / Monday AM (Departures)',
      bestTimeColor: 'text-purple-600',
      goal: 'Rematch (Instant Pickup).',
      rule: 'Never wait in the queue if it has 50+ cars. It is a math trap. Only drop off passengers and fish for an instant "Rematch" ping. If no ping in 2 mins, leave.',
      warning: true,
    },
    {
      id: 'void',
      title: 'The Dead Zone',
      emoji: '🏜️',
      examples: 'Rural areas, exurbs, low density',
      bestTime: 'NEVER.',
      bestTimeColor: 'text-rose-600',
      goal: 'Escape.',
      rule: 'If a ride takes you here, you must factor in the "Deadhead" return. Do not accept a 45 min ride to a rural town unless it pays 2.0x surge, because you will drive 45 mins back for free.',
    },
  ];

  const selected = universalZones.find(z => z.id === selectedZone);

  return (
    <Card className="shadow-lg border-gray-200">
      <CardHeader className="border-b border-gray-100">
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="w-5 h-5 text-gray-600" />
          Universal Zone Logic
        </CardTitle>
        <p className="text-sm text-gray-500">Every market has these four zones. Identify them in your city to master positioning.</p>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {universalZones.map((zone) => (
            <div
              key={zone.id}
              onClick={() => setSelectedZone(zone.id === selectedZone ? null : zone.id)}
              className={`cursor-pointer bg-white border rounded-xl p-4 transition-all duration-200 hover:shadow-md group ${
                selectedZone === zone.id ? 'ring-2 ring-gray-900' : 'border-gray-200'
              }`}
            >
              <span className="text-3xl block mb-2 group-hover:scale-110 transition-transform duration-200">
                {zone.emoji}
              </span>
              <h4 className="font-bold text-gray-900 text-sm">{zone.title}</h4>
              <p className="text-xs text-gray-500 mt-1">{zone.examples}</p>
            </div>
          ))}
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          {selected ? (
            <div className="animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-start gap-4">
                <span className="text-3xl">{selected.emoji}</span>
                <div className="flex-1">
                  <h4 className="text-lg font-bold text-gray-900">{selected.title}</h4>
                  <p className={`font-bold mt-2 ${selected.bestTimeColor}`}>
                    Best Time: {selected.bestTime}
                  </p>
                  <p className="text-sm text-gray-700 mt-2">
                    <strong>Goal:</strong> {selected.goal}
                  </p>
                  <p className="text-sm text-gray-700 mt-2">
                    <strong>Rule:</strong>{' '}
                    {selected.warning ? (
                      <span className="text-rose-600 font-semibold">{selected.rule}</span>
                    ) : (
                      selected.rule
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-gray-400">
              <span className="text-2xl block mb-2">ℹ️</span>
              Click on a zone type above to learn the universal rules for that environment.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ZoneCards;
