import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Navigation, MapPin, DollarSign } from "lucide-react";
import { openNavigation } from "@/utils/co-pilot-helpers";

interface BusinessHours {
  isOpen?: boolean;
  todayHours?: string;
  closingTime?: string;
  weekdayTexts?: string[];
}

// NOTE: isOpen is calculated server-side using the correct venue timezone
// Client-side recalculation was removed because browser timezone != venue timezone
// This caused late-night venues to show as closed in production
// Server calculates isOpen in venue-enrichment.js using Intl.DateTimeFormat with snapshot timezone

interface Block {
  name: string;
  address?: string;
  category?: string;
  coordinates?: { lat: number; lng: number };
  placeId?: string;
  estimated_distance_miles?: number;
  driveTimeMinutes?: number;
  value_per_min?: number;
  value_grade?: string;
  isOpen?: boolean;
  businessHours?: BusinessHours | string;
}

interface BarsTableProps {
  blocks?: Block[];
}

// Convert value metrics to price tier display
function getPriceTier(block: Block): { tier: string; color: string; priority: number } {
  const grade = block.value_grade;
  const valuePerMin = block.value_per_min || 0;

  if (grade === "A" && valuePerMin > 0.8) {
    return { tier: "$$$$$", color: "text-amber-600", priority: 5 };
  } else if (grade === "A" && valuePerMin > 0.6) {
    return { tier: "$$$$", color: "text-amber-600", priority: 4 };
  } else if (grade === "A" || (grade === "B" && valuePerMin > 0.5)) {
    return { tier: "$$$", color: "text-amber-700", priority: 3 };
  } else if (grade === "B") {
    return { tier: "$$", color: "text-gray-700", priority: 2 };
  }
  return { tier: "$", color: "text-gray-500", priority: 1 };
}

// Extract closing time from business hours
function getClosingInfo(businessHours: BusinessHours | string | undefined): string | null {
  if (!businessHours) return null;

  // Handle string format (condensed hours like "Mon-Fri: 6AM-10PM" or "5:00 PM - 2:00 AM")
  if (typeof businessHours === "string") {
    // Try to extract closing time from string (the time after the dash/hyphen)
    const closeMatch = businessHours.match(/[-–]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
    if (closeMatch) return closeMatch[1];
    // If no match found, don't return the full string - that would be redundant with todayHours
    return null;
  }

  // Handle object format
  if (businessHours.closingTime) {
    return businessHours.closingTime;
  }

  if (businessHours.todayHours) {
    const closeMatch = businessHours.todayHours.match(/[-–]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
    if (closeMatch) return closeMatch[1];
    return businessHours.todayHours;
  }

  return null;
}

// Get today's hours from weekday texts
function getTodayHours(businessHours: BusinessHours | string | undefined): string | null {
  if (!businessHours) return null;

  if (typeof businessHours === "string") {
    return businessHours;
  }

  if (businessHours.todayHours) {
    return businessHours.todayHours;
  }

  // Try to find today in weekdayTexts
  if (businessHours.weekdayTexts && Array.isArray(businessHours.weekdayTexts)) {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const todayEntry = businessHours.weekdayTexts.find((t) =>
      t.toLowerCase().startsWith(today.toLowerCase())
    );
    if (todayEntry) {
      // Extract just the hours part
      const hoursMatch = todayEntry.match(/:\s*(.+)$/);
      return hoursMatch ? hoursMatch[1] : todayEntry;
    }
  }

  return null;
}

// Get bar category color
function getCategoryColor(name: string, category?: string): string {
  const lowerName = (name || "").toLowerCase();
  const lowerCat = (category || "").toLowerCase();

  if (lowerCat.includes("nightclub") || lowerCat.includes("club") || lowerName.includes("club")) {
    return "bg-purple-500"; // Nightclubs - purple
  }
  if (lowerCat.includes("bar") || lowerName.includes("bar") || lowerName.includes("tavern") || lowerName.includes("pub")) {
    return "bg-amber-500"; // Bars - amber
  }
  if (lowerCat.includes("brewery") || lowerName.includes("brewery")) {
    return "bg-yellow-600"; // Breweries - dark yellow
  }
  if (lowerCat.includes("lounge") || lowerName.includes("lounge")) {
    return "bg-indigo-500"; // Lounges - indigo
  }
  if (lowerCat.includes("restaurant") || lowerCat.includes("grill") || lowerName.includes("grill")) {
    return "bg-rose-500"; // Restaurants - rose
  }
  return "bg-blue-500"; // Default
}

// Open navigation (uses Apple Maps on iOS/macOS, Google Maps elsewhere)
function handleNavigation(block: Block) {
  openNavigation({
    lat: block.coordinates?.lat,
    lng: block.coordinates?.lng,
    placeId: block.placeId,
    name: block.name,
    address: block.address
  });
}

export default function BarsTable({ blocks }: BarsTableProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  // Filter for bars, restaurants, lounges
  const bars = blocks.filter((block) => {
    const category = (block.category || "").toLowerCase();
    const name = (block.name || "").toLowerCase();

    const isBevenue =
      category.includes("bar") ||
      category.includes("nightlife") ||
      category.includes("restaurant") ||
      category.includes("lounge") ||
      category.includes("club") ||
      category.includes("pub") ||
      category.includes("tavern") ||
      category.includes("brewery") ||
      category.includes("winery") ||
      category.includes("grill") ||
      category.includes("cantina") ||
      category.includes("steakhouse") ||
      name.includes("bar") ||
      name.includes("grill") ||
      name.includes("tavern") ||
      name.includes("pub");

    const isNotCommon =
      !name.includes("kroger") &&
      !name.includes("walmart") &&
      !name.includes("whole foods") &&
      !name.includes("grocery") &&
      !name.includes("school") &&
      !name.includes("hospital") &&
      !name.includes("college") &&
      !name.includes("medical") &&
      !name.includes("event center") &&
      !name.includes("stadium") &&
      !name.includes("airport") &&
      !name.includes("gas station") &&
      !name.includes("convenience");

    return isBevenue && isNotCommon;
  });

  // Filter out closed venues - only show open or unknown status
  const openBars = bars.filter((bar) => bar.isOpen !== false);

  if (openBars.length === 0) {
    return null;
  }

  // Sort by price tier ($$$$$ first), then by distance
  const sortedBars = [...openBars].sort((a, b) => {
    const tierA = getPriceTier(a);
    const tierB = getPriceTier(b);

    // Primary sort: price tier descending
    if (tierB.priority !== tierA.priority) {
      return tierB.priority - tierA.priority;
    }

    // Secondary sort: distance ascending
    const distA = a.estimated_distance_miles || 999;
    const distB = b.estimated_distance_miles || 999;
    return distA - distB;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-800">Late Night Hotspots</h3>
          <span className="text-xs text-gray-500">({sortedBars.length} venues)</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <DollarSign className="w-3 h-3" />
          <span>Sorted by earnings potential</span>
        </div>
      </div>

      <div className="space-y-2">
        {sortedBars.map((bar, idx) => {
          const priceTier = getPriceTier(bar);
          const closingTime = getClosingInfo(bar.businessHours);
          const todayHours = getTodayHours(bar.businessHours);
          const categoryColor = getCategoryColor(bar.name, bar.category);
          const distance = bar.estimated_distance_miles;
          const driveTime = bar.driveTimeMinutes;
          // Trust server's isOpen - calculated with correct venue timezone
          const isOpen = bar.isOpen;

          return (
            <Card
              key={idx}
              className={`border transition-all hover:shadow-md ${
                isOpen === true
                  ? "border-green-200 bg-green-50/30"
                  : isOpen === false
                  ? "border-gray-200 bg-gray-50/50 opacity-60"
                  : "border-purple-200 bg-white"
              }`}
              data-testid={`venue-card-${idx}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {/* Category Color Pin */}
                  <div className="flex-shrink-0 pt-1">
                    <div className={`w-3 h-3 rounded-full ${categoryColor}`} title={bar.category || "Venue"} />
                  </div>

                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: Name + Price Tier */}
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold text-gray-900 truncate">{bar.name}</h4>
                      <span className={`font-bold text-lg ${priceTier.color} flex-shrink-0`}>
                        {priceTier.tier}
                      </span>
                    </div>

                    {/* Row 2: Address */}
                    {bar.address && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-xs text-gray-600 truncate">{bar.address}</span>
                      </div>
                    )}

                    {/* Row 3: Hours + Status */}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {/* Today's Hours */}
                      {todayHours && (
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-blue-500 flex-shrink-0" />
                          <span className="text-xs text-gray-700 font-mono">{todayHours}</span>
                        </div>
                      )}

                      {/* Closing Time Badge */}
                      {closingTime && (
                        <Badge className="bg-orange-100 text-orange-700 border-0 text-xs">
                          Closes {closingTime}
                        </Badge>
                      )}

                      {/* Open/Closed Status */}
                      <Badge
                        className={`text-xs ${
                          isOpen === true
                            ? "bg-green-100 text-green-700 border-0"
                            : isOpen === false
                            ? "bg-red-100 text-red-700 border-0"
                            : "bg-gray-100 text-gray-600 border-0"
                        }`}
                      >
                        {isOpen === true ? "Open Now" : isOpen === false ? "Closed" : "Hours Unknown"}
                      </Badge>
                    </div>

                    {/* Row 4: Distance + Drive Time + Navigate Button */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        {distance && <span>{distance} mi</span>}
                        {driveTime && <span>~{driveTime} min drive</span>}
                      </div>

                      {/* Navigate Button */}
                      <button
                        onClick={() => handleNavigation(bar)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                      >
                        <Navigation className="w-3 h-3" />
                        Navigate
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
