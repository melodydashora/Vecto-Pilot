import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, AlertCircle, TrendingUp, ChevronDown, ChevronUp, Navigation, Calendar } from "lucide-react";
import { filterValidEvents, formatEventDate, formatEventTimeRange } from "@/utils/co-pilot-helpers";

// 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
interface Event {
  title: string;
  venue?: string;
  address?: string;
  event_start_date?: string;
  event_end_date?: string;  // For multi-day events (e.g., Dec 1 - Jan 4)
  event_start_time?: string;
  event_end_time?: string;
  type?: string;
  subtype?: string;
  estimated_distance_miles?: number;
  impact?: "high" | "medium" | "low";
  recommended_driver_action?: string;
  confidence?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  [key: string]: unknown;
}

interface EventsComponentProps {
  events: Event[];
  isLoading?: boolean;
}

export default function EventsComponent({ events, isLoading: _isLoading }: EventsComponentProps) {
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    today: true,
    upcoming: true,
    concerts: true,
    sports: true,
    festivals: true,
    conventions: true,
    other: true,
  });

  // Filter events - only show events with valid times
  const { todayEvents, upcomingEvents, invalidEvents } = filterValidEvents(events);
  const validEvents = [...todayEvents, ...upcomingEvents];

  // Log filtering results for debugging
  if (invalidEvents.length > 0) {
    console.log(`[EventsComponent] Filtered out ${invalidEvents.length} events without valid times`);
  }

  // Open navigation to event location
  const openNavigation = (event: Event) => {
    // Try coordinates first, fall back to address
    if (event.latitude && event.longitude) {
      // Use Google Maps with coordinates
      const url = `https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}`;
      window.open(url, '_blank');
    } else if (event.address) {
      // Use address for navigation
      const encodedAddress = encodeURIComponent(event.address);
      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
      window.open(url, '_blank');
    } else if (event.venue) {
      // Try venue name as last resort
      const encodedVenue = encodeURIComponent(event.venue);
      const url = `https://www.google.com/maps/search/?api=1&query=${encodedVenue}`;
      window.open(url, '_blank');
    }
  };

  const hasNavigationInfo = (event: Event) => {
    return !!(event.latitude && event.longitude) || !!event.address || !!event.venue;
  };

  const getImpactColor = (impact?: string) => {
    switch (impact) {
      case "high":
        return "bg-red-100 text-red-700 border-red-300";
      case "medium":
        return "bg-yellow-100 text-yellow-700 border-yellow-300";
      default:
        return "bg-green-100 text-green-700 border-green-300";
    }
  };

  const _getCategoryIcon = (subtype?: string) => {
    if (!subtype) return "📌";
    const sub = subtype.toLowerCase();
    if (sub.includes("concert") || sub.includes("music")) return "🎵";
    if (sub.includes("sport") || sub.includes("game")) return "🏀";
    if (sub.includes("festival") || sub.includes("fair")) return "🎉";
    if (sub.includes("convention") || sub.includes("expo")) return "🎪";
    if (sub.includes("theater") || sub.includes("show")) return "🎭";
    return "📍";
  };

  const getCategoryName = (subtype?: string): string => {
    if (!subtype) return "other";
    const sub = subtype.toLowerCase();
    if (sub.includes("concert") || sub.includes("music")) return "concerts";
    if (sub.includes("sport") || sub.includes("game")) return "sports";
    if (sub.includes("festival") || sub.includes("fair")) return "festivals";
    if (sub.includes("convention") || sub.includes("expo")) return "conventions";
    if (sub.includes("theater") || sub.includes("show")) return "other";
    return "other";
  };

  // Group events by category (using only valid events)
  const groupedEvents = validEvents.reduce((acc, event) => {
    const category = getCategoryName(event.subtype);
    if (!acc[category]) acc[category] = [];
    acc[category].push(event);
    return acc;
  }, {} as Record<string, Event[]>);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const categoryDisplayNames: Record<string, string> = {
    concerts: "🎵 Concerts & Live Music",
    sports: "🏀 Sports & Games",
    festivals: "🎉 Festivals & Events",
    conventions: "🎪 Conventions & Expos",
    other: "📍 Events",
  };

  const categoryColors: Record<string, string> = {
    concerts: "from-pink-50 to-rose-50 border-pink-200",
    sports: "from-blue-50 to-cyan-50 border-blue-200",
    festivals: "from-purple-50 to-indigo-50 border-purple-200",
    conventions: "from-yellow-50 to-amber-50 border-yellow-200",
    other: "from-gray-50 to-slate-50 border-gray-200",
  };

  if (!events || events.length === 0 || validEvents.length === 0) {
    return (
      <Card className="bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8 text-gray-500">
            <AlertCircle className="w-5 h-5 mr-2" />
            <span>No events found with valid times</span>
          </div>
          {invalidEvents.length > 0 && (
            <p className="text-xs text-center text-gray-400 mt-2">
              ({invalidEvents.length} events rejected - missing start/end times)
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="events-component">
      {Object.entries(groupedEvents)
        .sort(([a], [b]) => {
          const order = { concerts: 0, sports: 1, festivals: 2, conventions: 3, other: 4 };
          return (order[a as keyof typeof order] || 999) - (order[b as keyof typeof order] || 999);
        })
        .map(([category, categoryEvents]) => (
          <Card
            key={category}
            className={`bg-gradient-to-r ${categoryColors[category]}`}
            data-testid={`events-category-${category}`}
          >
            <CardHeader
              className="pb-2 cursor-pointer hover:opacity-75 transition-opacity"
              onClick={() => toggleCategory(category)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {categoryDisplayNames[category]}
                  <Badge variant="outline" className="bg-white/70 text-gray-700 border-gray-300 ml-2">
                    {categoryEvents.length}
                  </Badge>
                </CardTitle>
                {expandedCategories[category] ? (
                  <ChevronUp className="w-5 h-5 text-gray-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-600" />
                )}
              </div>
            </CardHeader>

            {expandedCategories[category] && (
              <CardContent>
                <div className="space-y-3">
                  {categoryEvents.map((event, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-white/60 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors"
                      data-testid={`event-${category}-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 text-sm leading-tight">{event.title}</h4>
                          {event.venue && (
                            <p className="text-xs text-gray-600 mt-0.5">@ {event.venue}</p>
                          )}
                        </div>
                        {event.impact && (
                          <Badge variant="outline" className={`text-xs ${getImpactColor(event.impact)}`}>
                            {event.impact}
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-1.5 text-xs text-gray-600">
                        {/* Date and Time - Always show for valid events */}
                        {/* 2026-01-10: Use symmetric field names (event_start_date, event_start_time) */}
                        <div className="flex flex-wrap items-center gap-2">
                          {event.event_start_date && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-indigo-500 flex-shrink-0" />
                              <span className={`font-medium ${formatEventDate(event.event_start_date) === 'Today' ? 'text-green-600' : 'text-indigo-600'}`}>
                                {formatEventDate(event.event_start_date)}
                              </span>
                            </div>
                          )}
                          {event.event_start_time && (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-gray-500 flex-shrink-0" />
                              <span>{formatEventTimeRange(event.event_start_time, event.event_end_time)}</span>
                            </div>
                          )}
                        </div>

                        {event.address && (
                          <div className="flex items-start gap-2">
                            <MapPin className="w-3 h-3 text-gray-500 mt-0.5 flex-shrink-0" />
                            <span>{event.address}</span>
                          </div>
                        )}

                        {event.estimated_distance_miles && (
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-3 h-3 text-gray-500 flex-shrink-0" />
                            <span>{event.estimated_distance_miles} miles away</span>
                          </div>
                        )}
                      </div>

                      {/* Navigation button */}
                      {hasNavigationInfo(event) && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs h-7 bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              openNavigation(event);
                            }}
                          >
                            <Navigation className="w-3 h-3 mr-1.5" />
                            Navigate to Venue
                          </Button>
                        </div>
                      )}

                      {event.recommended_driver_action && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <p className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded">
                            💡 {event.recommended_driver_action}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
    </div>
  );
}
