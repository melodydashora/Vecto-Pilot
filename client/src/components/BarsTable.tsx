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

  // Filter for EXPENSIVE bars/restaurants where you can sit down and drink
  // Must: sell alcohol, sit-down service, expensive (Grade A or high value)
  const bars = blocks.filter(block => {
    const category = (block.category || "").toLowerCase();
    const name = (block.name || "").toLowerCase();
    
    // Only include actual bars/nightlife/upscale dining
    const isBevenue = category.includes("bar") || 
                     category.includes("nightlife") || 
                     (category.includes("restaurant") && block.value_grade === "A");
    
    // Exclude non-bar venues
    const isNotCommon = !name.includes("kroger") && 
                       !name.includes("walmart") && 
                       !name.includes("whole foods") &&
                       !name.includes("grocery") &&
                       !name.includes("school") &&
                       !name.includes("hospital") &&
                       !name.includes("college") &&
                       !name.includes("medical") &&
                       !name.includes("event center") &&
                       !name.includes("stadium");
    
    // Only expensive venues (Grade A or B minimum)
    const isExpensive = block.value_grade === "A" || block.value_grade === "B";
    
    return isBevenue && isNotCommon && isExpensive;
  });

  if (bars.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-gray-800">Expensive Bars & Lounges</h3>
        <span className="text-xs text-gray-500">({bars.length} venues)</span>
      </div>

      <Card className="border-purple-200 bg-white">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-purple-50">
                <th className="px-3 py-2 text-left font-semibold text-gray-700 text-xs">Venue</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 text-xs">Address</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 text-xs">Hours</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-700 text-xs">Status</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((bar, idx) => (
                <tr
                  key={idx}
                  className={`border-b hover:bg-purple-50 transition-colors text-xs ${
                    idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                  }`}
                  data-testid={`bars-row-${idx}`}
                >
                  <td className="px-3 py-2 font-medium text-gray-900">{bar.name}</td>
                  <td className="px-3 py-2 text-gray-600 truncate max-w-xs">{bar.address || "—"}</td>
                  <td className="px-3 py-2">
                    {bar.businessHours ? (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-blue-600 flex-shrink-0" />
                        <span className="text-gray-700 font-mono text-xs">{bar.businessHours}</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge
                      className={`text-xs ${
                        bar.isOpen === true
                          ? "bg-green-100 text-green-700 border-0"
                          : bar.isOpen === false
                          ? "bg-red-100 text-red-700 border-0"
                          : "bg-gray-100 text-gray-700 border-0"
                      }`}
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
    </div>
  );
}
