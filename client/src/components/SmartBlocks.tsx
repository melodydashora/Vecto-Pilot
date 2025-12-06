import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Loader } from "lucide-react";

interface SmartBlocksProps {
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  snapshotLat?: number;
  snapshotLng?: number;
  holiday?: string | null;
  showTrafficOnly?: boolean;
  blocks?: Array<{
    name: string;
    address?: string;
    estimated_distance_miles?: number;
    driveTimeMinutes?: number;
    value_per_min?: number;
    value_grade?: string;
  }>;
}

export default function SmartBlocks({ blocks }: SmartBlocksProps) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (blocks && blocks.length > 0) {
      setLastUpdated(new Date());
    }
  }, [blocks]);

  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <MapPin className="h-4 w-4" />
        <span>Showing {blocks.length} recommended staging areas</span>
      </div>
      {blocks.map((block, idx) => (
        <Card key={idx} className="border-slate-200 bg-white hover:border-slate-300 transition-colors">
          <CardContent className="p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm text-gray-900 truncate">{block.name}</h4>
                {block.address && (
                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">{block.address}</p>
                )}
              </div>
              {block.value_grade && (
                <div className="ml-2 flex items-center gap-2 whitespace-nowrap">
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${
                    block.value_grade === 'A' 
                      ? 'bg-green-100 text-green-700'
                      : block.value_grade === 'B'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {block.value_grade}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
