import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, DollarSign } from "lucide-react";

interface Block {
  name: string;
  address?: string;
  category?: string;
  estimated_distance_miles?: number;
  driveTimeMinutes?: number;
  value_per_min?: number;
  value_grade?: string;
  isOpen?: boolean;
  businessHours?: string;
}

interface BarsTableProps {
  blocks?: Block[];
}

export default function BarsTable({ blocks }: BarsTableProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  // Filter for bars, restaurants, nightlife, and dining venues
  const bars = blocks.filter(block => {
    const category = (block.category || "").toLowerCase();
    const name = (block.name || "").toLowerCase();
    
    // Include venues with bar/restaurant/nightlife/dining categories
    const hasBevCategory = category.includes("bar") || 
                          category.includes("restaurant") || 
                          category.includes("nightlife") || 
                          category.includes("dining") ||
                          category.includes("entertainment");
    
    // Also filter out obvious non-bar venues by name patterns
    const isNotGrocery = !name.includes("kroger") && 
                        !name.includes("walmart") && 
                        !name.includes("whole foods") &&
                        !name.includes("grocery") &&
                        !name.includes("school") &&
                        !name.includes("high school") &&
                        !name.includes("college");
    
    return hasBevCategory && isNotGrocery;
  });

  if (bars.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-800">Bars & Premium Venues</h3>
        <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">
          ML Training Data
        </Badge>
        <span className="text-sm text-gray-500">({bars.length} venues)</span>
      </div>

      <Card className="border-purple-200 bg-white">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-purple-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Venue Name</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Address</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Distance</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Drive Time</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Business Hours</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Value/Min</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Grade</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar, idx) => (
                <tr
                  key={idx}
                  className={`border-b hover:bg-purple-50 transition-colors ${
                    idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                  }`}
                  data-testid={`bars-row-${idx}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{bar.name}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate text-xs">
                    {bar.address || "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {bar.estimated_distance_miles !== undefined
                      ? `${bar.estimated_distance_miles.toFixed(1)} mi`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {bar.driveTimeMinutes !== undefined ? `${bar.driveTimeMinutes} min` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {bar.businessHours ? (
                      <div className="flex items-start gap-1">
                        <Clock className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <span className="text-xs text-gray-700 font-mono max-w-xs">
                          {bar.businessHours}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">No hours</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {bar.value_per_min !== undefined ? (
                      <div className="flex items-center justify-center gap-1">
                        <DollarSign className="h-3 w-3 text-green-600" />
                        <span className="text-gray-700 font-semibold">
                          ${bar.value_per_min.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {bar.value_grade ? (
                      <Badge
                        className={`text-xs font-bold ${
                          bar.value_grade === "A"
                            ? "bg-green-100 text-green-700"
                            : bar.value_grade === "B"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {bar.value_grade}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      className={
                        bar.isOpen === true
                          ? "bg-green-100 text-green-700 border-0 text-xs"
                          : bar.isOpen === false
                          ? "bg-red-100 text-red-700 border-0 text-xs"
                          : "bg-gray-100 text-gray-700 border-0 text-xs"
                      }
                    >
                      {bar.isOpen === true ? "Open" : bar.isOpen === false ? "Closed" : "Unknown"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-500 italic">
        📊 Business hours data captured for ML training model. Track venue performance and driver
        behavior patterns.
      </p>
    </div>
  );
}
