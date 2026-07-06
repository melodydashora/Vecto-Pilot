// client/src/components/offer-analyzer/GeographyCard.tsx
// 2026-07-03 (todo #10): Avoid-places editor (design §3 avoid[]). 100% user-entered
// places via GET /api/offer-analyzer/places/search — identity is the Google
// place_id with 6-decimal coords from Places, never typed coordinates and never
// code constants (zero-hardcoded-locations decision, design §1.4).

import { useEffect, useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SwitchRow } from './controls';
import { useToast } from '@/hooks/useToast';
import { getAuthHeader } from '@/utils/co-pilot-helpers';
import { API_ROUTES } from '@/constants/apiRoutes';
import type { AvoidMode, AvoidRule, OfferRulesetConfig } from '@/lib/offer-ruleset-schema';
import { makeAvoidRule } from '@/lib/offer-ruleset-schema';
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
function normalizePlaces(json: unknown): PlaceResult[] {
  const body = json as Record<string, unknown> | null;
  const arr = (body?.results ?? body?.places ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p) => {
      const location = p.location as Record<string, unknown> | undefined;
      const displayName = p.displayName as Record<string, unknown> | undefined;
      const lat = typeof p.lat === 'number' ? p.lat : (location?.latitude as number | undefined);
      const lng = typeof p.lng === 'number' ? p.lng : (location?.longitude as number | undefined);
      return {
        place_id: String(p.place_id ?? p.id ?? ''),
        label: String(p.label ?? p.name ?? displayName?.text ?? ''),
        formatted_address: String(p.formatted_address ?? p.formattedAddress ?? p.address ?? ''),
        lat: lat as number,
        lng: lng as number,
      };
    })
    .filter((p) => p.place_id && p.label && Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export default function GeographyCard({ form }: Props) {
  const { toast } = useToast();
  const avoid = useWatch({ control: form.control, name: 'avoid' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Guards a slow earlier response from overwriting a newer one.
  const searchSeqRef = useRef(0);

  const setAvoid = (rules: AvoidRule[]) => form.setValue('avoid', rules, { shouldDirty: true });

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
    setAvoid([...avoid, makeAvoidRule({ place_id: place.place_id, label: place.label, lat: place.lat, lng: place.lng })]);
    setQuery('');
    setResults([]);
    toast({ title: 'Place added', description: `${place.label} — adjust its mode below.` });
  };

  const updateRule = (i: number, patch: Partial<AvoidRule>) => {
    setAvoid(avoid.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  return (
    <Card className="bg-white border-gray-200 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MapPin className="h-5 w-5 text-red-500" />
          Geography
        </CardTitle>
        <CardDescription>Places and directions you don't want to be sent</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Place search */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search a city, road, or landmark…"
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
                <li key={place.place_id}>
                  <button
                    type="button"
                    className="w-full px-3 py-3 text-left hover:bg-gray-50 transition-colors"
                    onClick={() => addPlace(place)}
                  >
                    <span className="block text-sm font-medium text-gray-800">{place.label}</span>
                    <span className="block text-xs text-gray-500">{place.formatted_address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {avoid.length === 0 && (
          <p className="text-sm text-gray-400 italic">
            No avoid places yet — search above to add one.
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
