import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStrategy } from '@/hooks/useStrategy';
import { Loader2, AlertCircle, MapPin, TrendingUp, Radio, Newspaper, Calendar, Plane } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

export default function BriefingPage() {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  
  useEffect(() => {
    const handleSnapshot = (e: any) => {
      setSnapshotId(e.detail.snapshotId);
    };
    
    window.addEventListener('vecto-snapshot-saved', handleSnapshot);
    return () => window.removeEventListener('vecto-snapshot-saved', handleSnapshot);
  }, []);
  
  const { data, loading, error } = useStrategy(snapshotId || undefined);
  
  // Fetch snapshot data to get airport_context
  const { data: snapshotData } = useQuery({
    queryKey: ['/api/location/snapshots', snapshotId],
    queryFn: async () => {
      if (!snapshotId) return null;
      const response = await fetch(`/api/location/snapshots/${snapshotId}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!snapshotId,
    staleTime: 60000, // Cache for 1 minute
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
          <p className="text-sm text-gray-600">Loading briefing data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-600" />
          <p className="text-sm text-gray-600">Error loading briefing: {error}</p>
        </div>
      </div>
    );
  }

  if (!data || !data.strategy) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-gray-600">No briefing data available</p>
          <p className="text-xs text-gray-500 mt-1">Create a snapshot to see briefing data</p>
        </div>
      </div>
    );
  }

  const { strategy } = data;
  const briefing = strategy.briefing || {};
  const events = briefing.events || [];
  const traffic = briefing.traffic || [];
  const news = briefing.news || [];
  const holidays = briefing.holidays || [];
  
  // Extract airport context from snapshot
  const airportContext = snapshotData?.airport_context;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Intelligence Briefing</h1>
        <p className="text-sm text-gray-600">Raw AI pipeline outputs: FAA data, Strategist analysis, and Briefer intelligence</p>
        {data.status && (
          <Badge 
            variant={data.status === 'ok' ? 'default' : data.status === 'ok_partial' ? 'secondary' : 'destructive'}
            className="mt-2"
          >
            Status: {data.status}
          </Badge>
        )}
      </div>

      {/* FAA Airport Data Section */}
      {airportContext && (
        <Card data-testid="section-airport-data" className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plane className="w-5 h-5 text-blue-600" />
              FAA Airport Data (30-mile radius)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {airportContext.airports && airportContext.airports.length > 0 ? (
              <div className="space-y-4">
                {airportContext.airports.map((airport: any, index: number) => (
                  <div key={index} className="bg-white p-4 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">{airport.name} ({airport.code})</h4>
                      <Badge variant={airport.delays || airport.closures ? 'destructive' : 'default'}>
                        {airport.delays || airport.closures ? 'Active Issues' : 'Normal Operations'}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">Distance: {airport.distance_miles?.toFixed(1)} miles</p>
                    {airport.weather && (
                      <p className="text-sm text-gray-700 mb-1">
                        <span className="font-medium">Weather:</span> {airport.weather}
                      </p>
                    )}
                    {airport.delays && (
                      <p className="text-sm text-orange-700 mb-1">
                        <span className="font-medium">Delays:</span> {airport.delays}
                      </p>
                    )}
                    {airport.closures && (
                      <p className="text-sm text-red-700">
                        <span className="font-medium">Closures:</span> {airport.closures}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-sm italic">No airports within 30 miles or no FAA data available</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Strategist Output Section */}
      <Card data-testid="section-strategist-output" className="border-purple-200 bg-purple-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-purple-600" />
            Strategist Output (Claude Sonnet 4.5)
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {strategy.min ? (
            <div className="prose prose-sm max-w-none">
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{strategy.min}</p>
            </div>
          ) : (
            <p className="text-gray-400 text-sm italic">No strategist output available</p>
          )}
        </CardContent>
      </Card>

      {/* Briefer Intelligence Section - Events */}
      <Card data-testid="section-venues" className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" />
            Briefer Intelligence: Venues & Events (Gemini 2.5 Pro)
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {holidays.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold text-sm text-gray-700 mb-2">Holidays</h4>
              <div className="flex flex-wrap gap-2">
                {holidays.map((holiday: any, index: number) => (
                  <Badge key={index} variant="secondary" data-testid={`holiday-${index}`}>
                    {typeof holiday === 'string' ? holiday : holiday.name || JSON.stringify(holiday)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {events.length > 0 ? (
            <div>
              <h4 className="font-semibold text-sm text-gray-700 mb-2">Events</h4>
              <ul className="space-y-2">
                {events.map((item: any, index: number) => (
                  <li key={index} className="flex items-start gap-2" data-testid={`event-item-${index}`}>
                    <span className="text-green-600 mt-1">•</span>
                    <span className="text-gray-700">
                      {typeof item === 'string' ? item : item.title || item.name || item.summary || JSON.stringify(item)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            !holidays.length && <p className="text-gray-400 text-sm italic">No venue or event data available</p>
          )}
        </CardContent>
      </Card>

      {/* Briefer Intelligence Section - Traffic */}
      <Card data-testid="section-traffic" className="border-orange-200 bg-orange-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-orange-600" />
            Briefer Intelligence: Traffic (Gemini 2.5 Pro)
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {traffic.length > 0 ? (
            <ul className="space-y-2">
              {traffic.map((item: any, index: number) => (
                <li key={index} className="flex items-start gap-2" data-testid={`traffic-item-${index}`}>
                  <span className="text-orange-600 mt-1">•</span>
                  <span className="text-gray-700">
                    {typeof item === 'string' ? item : item.summary || item.note || JSON.stringify(item)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm italic">No traffic data available</p>
          )}
        </CardContent>
      </Card>

      {/* Briefer Intelligence Section - News */}
      <Card data-testid="section-news" className="border-indigo-200 bg-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-indigo-600" />
            Briefer Intelligence: News & Alerts (Gemini 2.5 Pro)
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {news.length > 0 ? (
            <ul className="space-y-2">
              {news.map((item: any, index: number) => (
                <li key={index} className="flex items-start gap-2" data-testid={`news-item-${index}`}>
                  <span className="text-indigo-600 mt-1">•</span>
                  <span className="text-gray-700">
                    {typeof item === 'string' ? item : item.title || item.summary || JSON.stringify(item)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm italic">No news available</p>
          )}
        </CardContent>
      </Card>

      {data.error_message && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="w-5 h-5" />
              Error Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-600 font-mono">{data.error_message}</p>
          </CardContent>
        </Card>
      )}

      <div className="text-center text-xs text-gray-500 pb-8">
        <p>Snapshot ID: {data.snapshot_id}</p>
        {strategy.user?.address && (
          <p className="mt-1">Location: {strategy.user.address}</p>
        )}
      </div>
    </div>
  );
}
