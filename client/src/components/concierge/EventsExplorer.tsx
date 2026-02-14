// client/src/components/concierge/EventsExplorer.tsx
// 2026-02-13: Quick filter buttons + split venue/event results for concierge page
// 2026-02-13: DB-first architecture — shows venues section (top) + events section (bottom)

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2, Calendar, Wine, Music, Laugh, UtensilsCrossed, Trophy,
  MapPin, Clock, Navigation, Star
} from 'lucide-react';
import { API_ROUTES } from '@/constants/apiRoutes';

export interface VenueItem {
  title: string;
  address?: string;
  type?: string;
  expense_rank?: number;
  venue_types?: string[];
  distance_hint?: string;
  description?: string;
  time?: string;
}

export interface EventItem {
  title: string;
  venue?: string;
  address?: string;
  type?: string;
  time?: string;
  description?: string;
  distance_hint?: string;
}

interface EventsExplorerProps {
  token: string;
  lat: number;
  lng: number;
  timezone: string;
  // 2026-02-13: Callback to share search results with parent (for map + chat context)
  onDataLoaded?: (venues: VenueItem[], events: EventItem[]) => void;
}

const QUICK_FILTERS = [
  { id: 'all', label: 'All Events', icon: Calendar },
  { id: 'bars', label: 'Best Bars', icon: Wine },
  { id: 'live_music', label: 'Live Music', icon: Music },
  { id: 'comedy', label: 'Comedy', icon: Laugh },
  { id: 'late_night', label: 'Late Night', icon: UtensilsCrossed },
  { id: 'sports', label: 'Sports', icon: Trophy },
] as const;

// Convert expense_rank (1-4) to dollar signs
function expenseDisplay(rank?: number): string | null {
  if (!rank) return null;
  return '$'.repeat(Math.min(rank, 4));
}

export function EventsExplorer({ token, lat, lng, timezone, onDataLoaded }: EventsExplorerProps) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [venues, setVenues] = useState<VenueItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFilter = async (filterId: string) => {
    setActiveFilter(filterId);
    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await fetch(API_ROUTES.CONCIERGE.PUBLIC_EXPLORE(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, filter: filterId, timezone }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      // 2026-02-13: API now returns {venues: [], events: []} (DB-first architecture)
      const newVenues = data.venues || [];
      const newEvents = data.events || [];
      setVenues(newVenues);
      setEvents(newEvents);
      // 2026-02-13: Share results with parent for map + chat context
      onDataLoaded?.(newVenues, newEvents);
    } catch (err) {
      console.error('[concierge] Search error:', err);
      setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
      setVenues([]);
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Open Google Maps navigation to an address
  const openNavigation = (address?: string) => {
    if (!address) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    window.open(url, '_blank');
  };

  const totalResults = venues.length + events.length;

  return (
    <div className="space-y-4">
      {/* Quick filter buttons — horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {QUICK_FILTERS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={activeFilter === id ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleFilter(id)}
            disabled={isLoading}
            className={`flex-shrink-0 gap-1.5 ${
              activeFilter === id
                ? 'bg-teal-600 hover:bg-teal-700 text-white'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Loader2 className="h-8 w-8 animate-spin text-teal-500 mb-3" />
          <p className="text-sm">Searching nearby...</p>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4 text-center">
            <p className="text-red-600 text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFilter(activeFilter)}
              className="mt-2"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══ VENUES SECTION (upscale lounges/bars at top) ═══ */}
      {!isLoading && !error && venues.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Wine className="h-4 w-4 text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-700">Lounges & Bars</h3>
            <span className="text-xs text-gray-400">({venues.length})</span>
          </div>
          {venues.map((venue, idx) => (
            <Card key={`v-${idx}`} className="bg-white border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 truncate">{venue.title}</h4>
                    {venue.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-1">{venue.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {expenseDisplay(venue.expense_rank) && (
                      <span className="text-xs font-medium text-amber-600">
                        {expenseDisplay(venue.expense_rank)}
                      </span>
                    )}
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                      {(venue.type || 'venue').replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  {venue.address && (
                    <button
                      onClick={() => openNavigation(venue.address)}
                      className="flex items-center gap-1 truncate hover:text-teal-600 transition-colors"
                    >
                      <Navigation className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{venue.address}</span>
                    </button>
                  )}
                  {venue.time && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Clock className="h-3 w-3" />
                      <span>{venue.time}</span>
                    </div>
                  )}
                </div>

                {venue.distance_hint && (
                  <p className="text-xs text-teal-600 mt-2">{venue.distance_hint}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ═══ EVENTS SECTION (time-limited happenings below) ═══ */}
      {!isLoading && !error && events.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-700">Events Tonight</h3>
            <span className="text-xs text-gray-400">({events.length})</span>
          </div>
          {events.map((event, idx) => (
            <Card key={`e-${idx}`} className="bg-white border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 truncate">{event.title}</h4>
                    {event.venue && event.venue !== event.title && (
                      <p className="text-sm text-gray-600 mt-0.5">{event.venue}</p>
                    )}
                  </div>
                  {event.type && (
                    <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full flex-shrink-0">
                      {event.type.replace('_', ' ')}
                    </span>
                  )}
                </div>

                {event.description && (
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{event.description}</p>
                )}

                <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  {event.address && (
                    <button
                      onClick={() => openNavigation(event.address)}
                      className="flex items-center gap-1 truncate hover:text-teal-600 transition-colors"
                    >
                      <Navigation className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{event.address}</span>
                    </button>
                  )}
                  {event.time && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Clock className="h-3 w-3" />
                      <span>{event.time}</span>
                    </div>
                  )}
                </div>

                {event.distance_hint && (
                  <p className="text-xs text-teal-600 mt-2">{event.distance_hint}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state (after search returned 0 results) */}
      {!isLoading && !error && hasSearched && totalResults === 0 && (
        <div className="text-center py-8 text-gray-500">
          <Calendar className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No results found nearby.</p>
          <p className="text-xs text-gray-400 mt-1">Try a different filter or search again later.</p>
        </div>
      )}

      {/* Initial prompt (before any search) */}
      {!hasSearched && !isLoading && (
        <div className="text-center py-8 text-gray-500">
          <Calendar className="h-10 w-10 mx-auto mb-3 text-teal-300" />
          <p className="text-sm font-medium text-gray-700">What are you looking for?</p>
          <p className="text-xs text-gray-400 mt-1">Tap a filter above to discover events and places nearby.</p>
        </div>
      )}
    </div>
  );
}
