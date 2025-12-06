import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock, AlertCircle, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";

interface Event {
  title: string;
  venue?: string;
  address?: string;
  event_date?: string;
  event_time?: string;
  type?: string;
  subtype?: string;
  estimated_distance_miles?: number;
  impact?: "high" | "medium" | "low";
  recommended_driver_action?: string;
  confidence?: string;
}

interface EventsComponentProps {
  events: Event[];
  isLoading?: boolean;
}

export default function EventsComponent({ events, isLoading }: EventsComponentProps) {
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    concerts: true,
    sports: true,
    festivals: true,
    conventions: true,
    other: false,
  });

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

  const getCategoryIcon = (subtype?: string) => {
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

  // Group events by category
  const groupedEvents = events.reduce((acc, event) => {
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
    other: "📍 Other Events",
  };

  const categoryColors: Record<string, string> = {
    concerts: "from-pink-50 to-rose-50 border-pink-200",
    sports: "from-blue-50 to-cyan-50 border-blue-200",
    festivals: "from-purple-50 to-indigo-50 border-purple-200",
    conventions: "from-yellow-50 to-amber-50 border-yellow-200",
    other: "from-gray-50 to-slate-50 border-gray-200",
  };

  if (!events || events.length === 0) {
    return (
      <Card className="bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8 text-gray-500">
            <AlertCircle className="w-5 h-5 mr-2" />
            <span>No events found for today</span>
          </div>
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
                        {event.address && (
                          <div className="flex items-start gap-2">
                            <MapPin className="w-3 h-3 text-gray-500 mt-0.5 flex-shrink-0" />
                            <span>{event.address}</span>
                          </div>
                        )}

                        {event.event_time && (
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3 text-gray-500 flex-shrink-0" />
                            <span>{event.event_time}</span>
                          </div>
                        )}

                        {event.estimated_distance_miles && (
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-3 h-3 text-gray-500 flex-shrink-0" />
                            <span>{event.estimated_distance_miles} miles away</span>
                          </div>
                        )}
                      </div>

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
