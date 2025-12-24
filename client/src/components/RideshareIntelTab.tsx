/**
 * RideshareIntelTab - Market Intelligence & Geofence Explorer
 *
 * Comprehensive analysis of major ride-share markets with:
 * - Market-specific regulations (vehicle age, required docs)
 * - Platform-specific rules (Uber vs Lyft)
 * - Dallas Strategy integration with Vectopilot coordinates
 * - Comparative analytics across markets
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import {
  Target,
  Car,
  FileText,
  Copy,
  Check,
  MapPin,
  Clock,
  Zap,
  Navigation,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

// --- MARKET DATA ---
type MarketKey = 'dallas' | 'nyc' | 'los_angeles' | 'chicago' | 'miami' | 'sf';

interface PlatformRules {
  vehicle_age: number;
  docs: string[];
  notes: string;
}

interface MarketData {
  name: string;
  center: { lat: number; lng: number };
  platforms: {
    uber: PlatformRules;
    lyft: PlatformRules;
  };
  boundary: [number, number][];
  stats: { density: number; marketShare: number };
}

// Generate approximate polygon for market boundaries
function generatePolygon(centerLat: number, centerLng: number, radiusKM: number, points = 12): [number, number][] {
  const coords: [number, number][] = [];
  const rLat = radiusKM / 111;
  const rLng = radiusKM / (111 * Math.cos(centerLat * Math.PI / 180));

  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    const lat = centerLat + (rLat * Math.sin(theta)) + (Math.random() * 0.01 - 0.005);
    const lng = centerLng + (rLng * Math.cos(theta)) + (Math.random() * 0.01 - 0.005);
    coords.push([lng, lat]);
  }
  return coords;
}

const marketData: Record<MarketKey, MarketData> = {
  dallas: {
    name: "Dallas-Fort Worth",
    center: { lat: 32.7767, lng: -96.7970 },
    platforms: {
      uber: {
        vehicle_age: 15,
        docs: ["Driver License", "Vehicle Registration", "Insurance", "TNC Inspection"],
        notes: "Must display trade dress on front and rear windshields. Strict airport FIFO queues."
      },
      lyft: {
        vehicle_age: 15,
        docs: ["Driver License", "Vehicle Registration", "Insurance", "Vehicle Inspection"],
        notes: "Lyft emblem required on front windshield. 24/7 support available at Hub."
      }
    },
    boundary: generatePolygon(32.7767, -96.7970, 25, 20),
    stats: { density: 45, marketShare: 60 }
  },
  nyc: {
    name: "New York City",
    center: { lat: 40.7128, lng: -74.0060 },
    platforms: {
      uber: {
        vehicle_age: 7,
        docs: ["TLC License", "DMV License", "Registration", "Commercial Insurance"],
        notes: "TLC Plates required. Cap on new vehicle licenses periodically active."
      },
      lyft: {
        vehicle_age: 7,
        docs: ["TLC License", "DMV License", "Registration", "Commercial Insurance"],
        notes: "High demand in outer boroughs. Strict TLC compliance monitoring."
      }
    },
    boundary: generatePolygon(40.7128, -74.0060, 15, 25),
    stats: { density: 120, marketShare: 55 }
  },
  los_angeles: {
    name: "Los Angeles",
    center: { lat: 34.0522, lng: -118.2437 },
    platforms: {
      uber: {
        vehicle_age: 15,
        docs: ["Driver License", "Registration", "Insurance", "Background Check"],
        notes: "LAX placard required for airport pickups. Very large coverage area."
      },
      lyft: {
        vehicle_age: 15,
        docs: ["Driver License", "Registration", "Insurance", "Background Check"],
        notes: "Strict vehicle cleanliness standards enforced. High demand in West Hollywood."
      }
    },
    boundary: generatePolygon(34.0522, -118.2437, 35, 18),
    stats: { density: 65, marketShare: 58 }
  },
  chicago: {
    name: "Chicago",
    center: { lat: 41.8781, lng: -87.6298 },
    platforms: {
      uber: {
        vehicle_age: 10,
        docs: ["Driver License", "Registration", "Insurance", "City Tax Emblem"],
        notes: "Must display City Tax Emblem. Restricted access to Navy Pier."
      },
      lyft: {
        vehicle_age: 10,
        docs: ["Driver License", "Registration", "Insurance", "City Tax Emblem"],
        notes: "Chicago TNP Chauffeur License required for some tiers."
      }
    },
    boundary: generatePolygon(41.8781, -87.6298, 20, 15),
    stats: { density: 55, marketShare: 52 }
  },
  miami: {
    name: "Miami",
    center: { lat: 25.7617, lng: -80.1918 },
    platforms: {
      uber: {
        vehicle_age: 15,
        docs: ["Driver License", "Registration", "Insurance", "Vehicle Inspection"],
        notes: "High seasonal variance. Port of Miami requires specific access procedures."
      },
      lyft: {
        vehicle_age: 15,
        docs: ["Driver License", "Registration", "Insurance", "Vehicle Inspection"],
        notes: "Trade dress on front windshield. Strong demand during Art Basel."
      }
    },
    boundary: generatePolygon(25.7617, -80.1918, 18, 12),
    stats: { density: 40, marketShare: 62 }
  },
  sf: {
    name: "San Francisco",
    center: { lat: 37.7749, lng: -122.4194 },
    platforms: {
      uber: {
        vehicle_age: 15,
        docs: ["Driver License", "Registration", "Insurance", "Business License"],
        notes: "Business license required after 7 days of operation."
      },
      lyft: {
        vehicle_age: 15,
        docs: ["Driver License", "Registration", "Insurance", "Business License"],
        notes: "SFO Airport requires distinct placard and FIFO lot usage."
      }
    },
    boundary: generatePolygon(37.7749, -122.4194, 12, 16),
    stats: { density: 85, marketShare: 48 }
  }
};

// Dallas-specific strategic zones
const dallasZones = [
  { name: 'DFW TNC Lot', type: 'Queue Zone', lat: 32.9098, lng: -97.0385, typeColor: 'text-amber-600' },
  { name: 'DAL TNC Lot', type: 'Queue Zone', lat: 32.8430, lng: -96.8520, typeColor: 'text-amber-600' },
  { name: 'Deep Ellum Core', type: 'High Demand', lat: 32.7845, lng: -96.7880, typeColor: 'text-blue-600' },
  { name: 'Uptown McKinney', type: 'High Demand', lat: 32.8020, lng: -96.8010, typeColor: 'text-blue-600' },
];

// Chart configuration
const chartConfig = {
  age: {
    label: "Max Vehicle Age",
    color: "#44403c", // stone-700
  },
  density: {
    label: "Drivers/Sq Mile",
    color: "#f97316", // orange-500
  },
};

export default function RideshareIntelTab() {
  const [currentMarket, setCurrentMarket] = useState<MarketKey>('dallas');
  const [currentPlatform, setCurrentPlatform] = useState<'uber' | 'lyft'>('uber');
  const [copied, setCopied] = useState(false);
  const [expandedDallas, setExpandedDallas] = useState(true);
  const [expandedAnalytics, setExpandedAnalytics] = useState(true);

  const market = marketData[currentMarket];
  const platformRules = market.platforms[currentPlatform];

  // Prepare chart data
  const ageChartData = Object.entries(marketData).map(([key, data]) => ({
    name: data.name.split(' ')[0],
    age: data.platforms.uber.vehicle_age,
  }));

  const densityChartData = Object.entries(marketData).map(([key, data]) => ({
    name: data.name.split(' ')[0],
    density: data.stats.density,
  }));

  const handleCopyCoords = useCallback(() => {
    const data = market.boundary;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [market.boundary]);

  const coordPreview = JSON.stringify(market.boundary).substring(0, 80) + "...";

  return (
    <div className="space-y-6 mb-24" data-testid="rideshare-intel-section">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Target className="w-6 h-6 text-amber-600" />
          <h1 className="text-2xl font-bold text-gray-900">Market Intelligence</h1>
        </div>
        <p className="text-gray-600">
          Boundary coordinates for geofencing (Vectopilot compatible), platform rules, and strategic insights.
        </p>
      </div>

      {/* Market Explorer */}
      <Card className="shadow-lg border-amber-200">
        <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100">
          <CardTitle className="text-lg flex items-center gap-2">
            <Navigation className="w-5 h-5 text-amber-600" />
            Market Explorer
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Controls Panel */}
            <div className="p-6 border-r border-gray-100 space-y-6">
              {/* Market Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Market</label>
                <Select value={currentMarket} onValueChange={(v) => setCurrentMarket(v as MarketKey)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a market" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(marketData).map(([key, data]) => (
                      <SelectItem key={key} value={key}>{data.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Platform Toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={currentPlatform === 'uber' ? 'default' : 'outline'}
                    className={currentPlatform === 'uber' ? 'bg-gray-900 text-white' : ''}
                    onClick={() => setCurrentPlatform('uber')}
                  >
                    Uber
                  </Button>
                  <Button
                    variant={currentPlatform === 'lyft' ? 'default' : 'outline'}
                    className={currentPlatform === 'lyft' ? 'bg-gray-900 text-white' : ''}
                    onClick={() => setCurrentPlatform('lyft')}
                  >
                    Lyft
                  </Button>
                </div>
              </div>

              {/* Vehicle Standards */}
              <div className="bg-amber-50 p-4 rounded-lg border border-amber-100">
                <h3 className="text-sm font-semibold text-amber-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Car className="w-4 h-4" />
                  Vehicle Standards
                </h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">•</span>
                    <span>Max Age: <strong>{platformRules.vehicle_age} years</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 font-bold">•</span>
                    <span>{platformRules.notes}</span>
                  </li>
                </ul>
              </div>

              {/* Required Docs */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Required Documents
                </h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  {platformRules.docs.map((doc, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span>{doc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Coordinate Export */}
              <div className="pt-4 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Boundary Data Preview</h4>
                <div className="bg-gray-900 rounded p-3 font-mono text-xs text-green-400 overflow-x-auto">
                  {coordPreview}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={handleCopyCoords}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2 text-green-600" />
                      Copied to Clipboard!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy JSON for Vectopilot
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Map/Stats Panel */}
            <div className="p-6 bg-gray-50 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">{market.name}</h3>
                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">
                  {market.stats.marketShare}% Market Share
                </Badge>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                  <div className="text-2xl font-bold text-gray-900">{market.stats.density}</div>
                  <div className="text-xs text-gray-500">Drivers/sq mi</div>
                </div>
                <div className="bg-white p-4 rounded-lg border border-gray-200 text-center">
                  <div className="text-2xl font-bold text-gray-900">{platformRules.vehicle_age}</div>
                  <div className="text-xs text-gray-500">Max Vehicle Age</div>
                </div>
              </div>

              {/* Center Coordinates */}
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-medium text-gray-700">Market Center</span>
                </div>
                <div className="font-mono text-sm text-gray-600">
                  {market.center.lat.toFixed(4)}, {market.center.lng.toFixed(4)}
                </div>
              </div>

              {/* Boundary Points Count */}
              <div className="mt-auto pt-4">
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center">
                  <span className="text-sm text-blue-800">
                    <strong>{market.boundary.length}</strong> boundary points available for geofencing
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dallas Strategy Section */}
      <Card className="shadow-lg border-purple-200 overflow-hidden">
        <CardHeader
          className="bg-gradient-to-r from-purple-50 via-blue-50 to-indigo-50 border-b border-purple-100 cursor-pointer"
          onClick={() => setExpandedDallas(!expandedDallas)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-600" />
              Dallas Strategy & Vectopilot Integration
            </CardTitle>
            {expandedDallas ? <ChevronUp className="w-5 h-5 text-purple-600" /> : <ChevronDown className="w-5 h-5 text-purple-600" />}
          </div>
        </CardHeader>

        {expandedDallas && (
          <CardContent className="p-6">
            <p className="text-gray-600 mb-6">
              A specialized operational plan for the DFW Metroplex leveraging geofenced zones to optimize driver positioning.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Strategy Points */}
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">1</div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">Airport FIFO Optimization</h3>
                    <p className="text-gray-600 text-sm mt-1">
                      DFW and DAL airports operate on strict FIFO queues. Enter the "TNC Waiting Lot" geofence to trigger queue placement. Leaving resets position.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">2</div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">Deep Ellum & Uptown Corridors</h3>
                    <p className="text-gray-600 text-sm mt-1">
                      High-demand nightlife zones. "Perch" on the periphery starting at 9:00 PM to capture initial surges without core traffic.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">3</div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">Event Geo-Fencing</h3>
                    <p className="text-gray-600 text-sm mt-1">
                      AT&T Stadium and American Airlines Center have dynamic geofences active 2 hours pre/post event for valid pickups.
                    </p>
                  </div>
                </div>
              </div>

              {/* Coordinates Table */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-purple-600" />
                  Vectopilot Critical Coordinates
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Centroid (Lat, Long)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dallasZones.map((zone, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-gray-800">{zone.name}</TableCell>
                        <TableCell className={zone.typeColor}>{zone.type}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-4 p-3 bg-blue-50 text-blue-800 text-xs rounded border border-blue-100 flex items-start gap-2">
                  <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span><strong>Tip:</strong> Copy these centroids into Vectopilot as "Target Anchors" for automated positioning.</span>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Comparative Analytics */}
      <Card className="shadow-lg border-gray-200">
        <CardHeader
          className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-100 cursor-pointer"
          onClick={() => setExpandedAnalytics(!expandedAnalytics)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-600" />
              Comparative Analytics
            </CardTitle>
            {expandedAnalytics ? <ChevronUp className="w-5 h-5 text-gray-600" /> : <ChevronDown className="w-5 h-5 text-gray-600" />}
          </div>
        </CardHeader>

        {expandedAnalytics && (
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Vehicle Age Chart */}
              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">Max Vehicle Age by Market</h3>
                <p className="text-xs text-gray-500 mb-4">Lower values indicate stricter requirements</p>
                <ChartContainer config={chartConfig} className="h-64 w-full">
                  <BarChart data={ageChartData}>
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="age" fill="#44403c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>

              {/* Density Chart */}
              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-2">Est. Active Driver Density</h3>
                <p className="text-xs text-gray-500 mb-4">Drivers per square mile (simulated data)</p>
                <ChartContainer config={chartConfig} className="h-64 w-full">
                  <BarChart data={densityChartData}>
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="density" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Footer Note */}
      <div className="text-center text-gray-400 text-xs">
        © 2025 RideShare Intel. Data for planning purposes only.
      </div>
    </div>
  );
}
