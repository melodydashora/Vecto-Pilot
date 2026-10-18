// client/src/components/offer-analyzer/GeographyCard.tsx
// 2026-07-03 (todo #10): Avoid-places editor (design §3 avoid[]). 100% user-entered
// places via GET /api/offer-analyzer/places/search — identity is the Google
// place_id with 6-decimal coords from Places, never typed coordinates and never
// code constants (zero-hardcoded-locations decision, design §1.4).
// 2026-10-17 (Melody, v3.3): stay-in zone on top of the avoid list. One picked city +
// radius + pickup buffer (+ optional dropoff cap) replaces listing every city to avoid.
// The same Places search feeds both: a result can become the zone or an avoid place.

import { useEffect, useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SliderRow, SwitchRow } from './controls';
import { useToast } from '@/hooks/useToast';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { API_ROUTES } from '@/constants/apiRoutes';
import type { AvoidMode, AvoidRule, OfferRulesetConfig, ZoneConfig } from '@/lib/offer-ruleset-schema';
import { ENABLE_SEEDS, makeAvoidRule, makeZone } from '@/lib/offer-ruleset-schema';
import { Loader2, MapPin, Search, Trash2 } from 'lucide-react';

interface Props {
  form: UseFormReturn<OfferRulesetConfig>;
}

interface PlaceResult {
  place_id: string;
  label: string;
  formatted_address: string;
  lat: number;
  lng: number;
}

const MODE_OPTIONS: Array<{ value: AvoidMode; label: string }> = [
  { value: 'destination_in', label: 'Destination inside' },
  { value: 'heads_toward', label: 'Trips heading toward' },
  { value: 'north_of', label: 'Anything north of' },
  { value: 'south_of', label: 'Anything south of' },
];

const MODE_HELP: Record<AvoidMode, string> = {
  destination_in: 'Rejects offers whose destination falls inside the radius around this place.',
  heads_toward:
    'Rejects offers pointing toward this place (pickup→dropoff bearing within the corridor), ignoring trips shorter than the minimum.',
  north_of: 'Rejects offers whose destination is north of this place.',
  south_of: 'Rejects offers whose destination is south of this place.',
};

// Tolerant of the exact JSON casing the parallel-built endpoint returns; the
// expected primary shape is { results: [{ place_id, label, formatted_address, lat, lng }] }.
// GET /api/offer-analyzer/places/search returns { success, results: [{ place_id, label,
// formatted_address, lat, lng, types }] } (server/api/offer-analyzer/index.js) — the
// server already normalizes Google's shape; only that contract is accepted here.
function normalizePlaces(json: unknown): PlaceResult[] {
  const body = json as { results?: unknown } | null;
  const arr = Array.isArray(body?.results) ? (body!.results as Array<Record<string, unknown>>) : [];
  return arr
    .map((p) => ({
      place_id: String(p.place_id ?? ''),
      label: String(p.label ?? ''),
      formatted_address: String(p.formatted_address ?? ''),
      lat: p.lat as number,
      lng: p.lng as number,
    }))
    .filter((p) => p.place_id && p.label && Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export default function GeographyCard({ form }: Props) {
  const { toast } = useToast();
  const avoid = useWatch({ control: form.control, name: 'avoid' });
  const zone = useWatch({ control: form.control, name: 'zone' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Guards a slow earlier response from overwriting a newer one.
  const searchSeqRef = useRef(0);

  const setAvoid = (rules: AvoidRule[]) => form.setValue('avoid', rules, { shouldDirty: true });
  const setZone = (next: ZoneConfig | null) => form.setValue('zone', next, { shouldDirty: true });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      try {
        const res = await fetch(API_ROUTES.OFFER_ANALYZER.PLACES_SEARCH(q), {
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        });
        if (!res.ok) throw new Error(`Place search failed (${res.status})`);
        const data = await res.json();
        if (seq === searchSeqRef.current) setResults(normalizePlaces(data));
      } catch (err) {
        console.warn('[OfferAnalyzer] place search failed:', err);
        if (seq === searchSeqRef.current) {
          setResults([]);
          toast({
            title: 'Search failed',
            description: 'Could not search places — try again.',
            variant: 'destructive',
          });
        }
      } finally {
        if (seq === searchSeqRef.current) setIsSearching(false);
      }
    }, 400); // debounce
    return () => clearTimeout(timer);
    // toast identity is stable; only re-run on keystrokes.
  }, [query, toast]);

  const addPlace = (place: PlaceResult) => {
    if (avoid.some((r) => r.place_id === place.place_id)) {
      toast({ title: 'Already in your list', description: place.label });
      return;
    }
    if (zone && zone.place_id === place.place_id) {
      toast({ title: 'That is your stay-in zone', description: `Remove the zone first to avoid ${place.label}.` });
      return;
    }
    setAvoid([...avoid, makeAvoidRule({ place_id: place.place_id, label: place.label, lat: place.lat, lng: place.lng })]);
    setQuery('');
    setResults([]);
    toast({ title: 'Place added', description: `${place.label} — adjust its mode below.` });
  };

  const chooseZone = (place: PlaceResult) => {
    if (avoid.some((r) => r.place_id === place.place_id)) {
      toast({ title: 'That place is on your avoid list', description: `Remove ${place.label} from avoid places first.` });
      return;
    }
    setZone(makeZone({ place_id: place.place_id, label: place.label, lat: place.lat, lng: place.lng }));
    setQuery('');
    setResults([]);
    toast({ title: 'Stay-in zone set', description: `${place.label} — adjust its radius and pickup buffer below.` });
  };

  const updateRule = (i: number, patch: Partial<AvoidRule>) => {
    setAvoid(avoid.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const updateZone = (patch: Partial<ZoneConfig>) => {
    if (zone) setZone({ ...zone, ...patch });
  };

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MapPin className="h-5 w-5 text-red-500" />
          Geography
        </CardTitle>
        <CardDescription>Where you want to stay, and places you don't want to be sent</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stay-in zone */}
        <div className="space-y-1">
          <span className="text-sm font-medium text-gray-700">Stay-in zone</span>
          <p className="text-xs text-gray-500">
            Pick the city you want to work instead of listing every place to avoid. Pickups may be a little
            outside it; a dropoff outside it must pay your $/mi floor over pickup + trip + the drive back to the zone edge.
          </p>
        </div>
        {zone ? (
          <div className="rounded-lg border border-gray-200 p-3 space-y-4" data-zone={zone.place_id}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-800 truncate">{zone.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-gray-400 hover:text-red-600"
                aria-label={`Remove zone ${zone.label}`}
                onClick={() => setZone(null)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <SliderRow
              label="Zone radius"
              value={zone.radius_mi}
              min={1}
              max={25}
              step={1}
              format={(v) => `${Math.round(v)} mi`}
              onChange={(v) => updateZone({ radius_mi: Math.round(v) })}
              help="How far around the city's map point still counts as inside. Cities aren't circles — set this to cover the parts you work."
            />
            <SliderRow
              label="Pickup buffer"
              value={zone.pickup_buffer_mi}
              min={0}
              max={10}
              step={0.5}
              format={(v) => `${v} mi`}
              onChange={(v) => updateZone({ pickup_buffer_mi: v })}
              help="Pickups this far outside the zone are still fine (a mall just over the city line). Farther out is rejected."
            />
            <SwitchRow
              label="Cap dropoff distance"
              checked={zone.max_away_mi != null}
              onCheckedChange={(on) => updateZone({ max_away_mi: on ? ENABLE_SEEDS.zone_max_away_mi : null })}
              help="Reject a dropoff past this many miles outside the zone, however well it pays. Off — pay alone decides."
            />
            {zone.max_away_mi != null && (
              <SliderRow
                label="Max miles past the edge"
                value={zone.max_away_mi}
                min={5}
                max={60}
                step={1}
                format={(v) => `${Math.round(v)} mi`}
                onChange={(v) => updateZone({ max_away_mi: Math.round(v) })}
              />
            )}
            <SwitchRow
              label="Enabled"
              checked={zone.enabled}
              onCheckedChange={(on) => updateZone({ enabled: on })}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No stay-in zone — search below and choose “Stay in”.</p>
        )}

        <Separator className="bg-gray-200" />

        {/* Place search — feeds the zone (when none is set) and the avoid list */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search a city, road, or landmark…"
              aria-label="Search a city, road, or landmark"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
            )}
          </div>
          {results.length > 0 && (
            <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {results.map((place) => (
                <li key={place.place_id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-800 truncate">{place.label}</span>
                    <span className="block text-xs text-gray-500 truncate">{place.formatted_address}</span>
                  </div>
                  {!zone && (
                    <Button type="button" size="sm" variant="outline" className="shrink-0"
                      aria-label={`Stay in ${place.label}`} onClick={() => chooseZone(place)}>
                      Stay in
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" className="shrink-0"
                    aria-label={`Avoid ${place.label}`} onClick={() => addPlace(place)}>
                    Avoid
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <span className="text-sm font-medium text-gray-700">Avoid places</span>
          <p className="text-xs text-gray-500">Places and directions you don't want to be sent, judged on top of the zone.</p>
        </div>

        {avoid.length === 0 && (
          <p className="text-sm text-gray-400 italic">
            No avoid places yet — search above and choose “Avoid”.
          </p>
        )}

        {/* Avoid-rule rows */}
        {avoid.map((rule, i) => (
          <div key={rule.place_id} className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-800 truncate">{rule.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-gray-400 hover:text-red-600"
                aria-label={`Remove ${rule.label}`}
                onClick={() => setAvoid(avoid.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* key: re-mount Radix Select when form.reset()/mode change updates the value */}
            <Select
              key={`${rule.place_id}-${rule.mode}`}
              value={rule.mode}
              onValueChange={(v) => updateRule(i, { mode: v as AvoidMode })}
            >
              <SelectTrigger className="bg-white border-gray-300 text-gray-800">
                <SelectValue placeholder="Rule mode" />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">{MODE_HELP[rule.mode]}</p>

            {rule.mode === 'destination_in' && (
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Radius (miles)</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="1"
                  value={rule.radius_mi ?? 6}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) updateRule(i, { radius_mi: n });
                  }}
                  className="bg-white border-gray-300 text-gray-900 w-32"
                />
              </div>
            )}

            {rule.mode === 'heads_toward' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Corridor (± degrees)</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    step="5"
                    min="5"
                    max="90"
                    value={rule.corridor_deg ?? 30}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) updateRule(i, { corridor_deg: n });
                    }}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Min trip (miles)</label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    value={rule.min_trip_mi ?? 8}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) updateRule(i, { min_trip_mi: n });
                    }}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
              </div>
            )}

            <SwitchRow
              label="Enabled"
              checked={rule.enabled}
              onCheckedChange={(on) => updateRule(i, { enabled: on })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
