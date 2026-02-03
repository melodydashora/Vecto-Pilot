import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, TrendingUp, Zap, DollarSign } from "lucide-react";

// 2026-01-09: Updated to camelCase to match SmartBlock type
interface MarketIntelligenceBlocksProps {
  blocks?: Array<{
    name: string;
    address?: string;
    estimatedDistanceMiles?: number;
    driveTimeMinutes?: number;
    valuePerMin?: number;
    valueGrade?: string;
    proTips?: string[];
  }>;
}

export default function MarketIntelligenceBlocks({ blocks }: MarketIntelligenceBlocksProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center gap-2 text-lg font-semibold text-gray-800">
        <TrendingUp className="h-5 w-5 text-blue-600" />
        Recommended Staging Areas
        <Badge className="bg-green-100 text-green-700 border-0 text-xs flex items-center gap-1">
          <Zap className="h-3 w-3" />
          Live
        </Badge>
      </div>

      {blocks.map((block, idx) => (
        <Card key={idx} className="border-slate-200 bg-white hover:border-blue-300 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base text-gray-900">{block.name}</CardTitle>
                {block.address && (
                  <p className="text-xs text-gray-600 mt-1 flex items-start gap-1">
                    <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2">{block.address}</span>
                  </p>
                )}
              </div>
              {block.valueGrade && (
                <div className={`text-xs font-bold px-2 py-1 rounded whitespace-nowrap ${
                  block.valueGrade === 'A'
                    ? 'bg-green-100 text-green-700'
                    : block.valueGrade === 'B'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  Grade {block.valueGrade}
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-0 space-y-3">
            <div className="flex gap-4 text-sm">
              {block.estimatedDistanceMiles !== undefined && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-700">{block.estimatedDistanceMiles.toFixed(1)} mi</span>
                </div>
              )}
              {block.driveTimeMinutes !== undefined && (
                <div className="text-gray-700">
                  {block.driveTimeMinutes} min drive
                </div>
              )}
              {block.valuePerMin !== undefined && (
                <div className="flex items-center gap-1">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  <span className="text-gray-700">${block.valuePerMin.toFixed(2)}/min</span>
                </div>
              )}
            </div>

            {block.proTips && block.proTips.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2 space-y-1">
                <p className="text-xs font-semibold text-blue-900">Pro Tips:</p>
                {block.proTips.slice(0, 2).map((tip, tipIdx) => (
                  <p key={tipIdx} className="text-xs text-blue-800 leading-snug">
                    • {tip.substring(0, 100)}...
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}