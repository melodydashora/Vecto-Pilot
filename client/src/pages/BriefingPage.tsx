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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Rideshare Briefing</h1>
        <p className="text-sm text-gray-600">Real-time intelligence for DFW rideshare drivers - events, traffic, and local conditions</p>
      </div>

      {/* Rideshare News Section */}
      <Card data-testid="section-news" className="border-indigo-200 bg-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-indigo-600" />
            Rideshare News
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {news.length > 0 ? (
            <ul className="space-y-3">
              {news.map((item: any, index: number) => (
                <li key={index} className="flex items-start gap-3 pb-3 border-b last:border-b-0 border-gray-100" data-testid={`news-item-${index}`}>
                  <TrendingUp className="w-4 h-4 text-indigo-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-gray-800 leading-relaxed">
                      {typeof item === 'string' ? item : item.title || item.summary || JSON.stringify(item)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm italic">No news available at this time</p>
          )}
        </CardContent>
      </Card>

      {/* Local Traffic Section */}
      <Card data-testid="section-traffic" className="border-orange-200 bg-orange-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-orange-600" />
            Local Traffic
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {traffic.length > 0 ? (
            <ul className="space-y-3">
              {traffic.map((item: any, index: number) => (
                <li key={index} className="flex items-start gap-3 pb-3 border-b last:border-b-0 border-gray-100" data-testid={`traffic-item-${index}`}>
                  <AlertCircle className="w-4 h-4 text-orange-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-gray-800 leading-relaxed">
                      {typeof item === 'string' ? item : item.summary || item.note || JSON.stringify(item)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm italic">No traffic alerts at this time</p>
          )}
        </CardContent>
      </Card>

      {/* Local Events Section */}
      <Card data-testid="section-events" className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" />
            Local Events
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          {holidays.length > 0 && (
            <div className="mb-4 pb-4 border-b border-gray-100">
              <h4 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
                <span>🎉</span> Holidays
              </h4>
              <div className="flex flex-wrap gap-2">
                {holidays.map((holiday: any, index: number) => (
                  <Badge key={index} variant="secondary" className="bg-amber-100 text-amber-900 border-amber-300" data-testid={`holiday-${index}`}>
                    {typeof holiday === 'string' ? holiday : holiday.name || JSON.stringify(holiday)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {events.length > 0 ? (
            <div>
              <h4 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Events
              </h4>
              <ul className="space-y-3">
                {events.map((item: any, index: number) => (
                  <li key={index} className="flex items-start gap-3 pb-3 border-b last:border-b-0 border-gray-100" data-testid={`event-item-${index}`}>
                    <MapPin className="w-4 h-4 text-green-600 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-gray-800 leading-relaxed">
                        {typeof item === 'string' ? item : item.title || item.name || item.summary || JSON.stringify(item)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            !holidays.length && <p className="text-gray-400 text-sm italic">No events scheduled at this time</p>
          )}
        </CardContent>
      </Card>

      {/* Airport Conditions Section */}
      {airportContext && airportContext.airports && airportContext.airports.length > 0 && (
        <Card data-testid="section-airport-data" className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plane className="w-5 h-5 text-blue-600" />
              Airport Conditions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {airportContext.airports.map((airport: any, index: number) => (
                <div key={index} className="bg-white p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">{airport.name} ({airport.code})</h4>
                    <Badge variant={airport.delays || airport.closures ? 'destructive' : 'default'}>
                      {airport.delays || airport.closures ? 'Active Issues' : 'Normal'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{airport.distance_miles?.toFixed(1)} miles away</p>
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
          </CardContent>
        </Card>
      )}

      {strategy.user?.address && (
        <div className="text-center text-sm text-gray-500 pb-8 pt-4 border-t border-gray-200">
          <p className="flex items-center justify-center gap-2">
            <MapPin className="w-4 h-4" />
            {strategy.user.address}
          </p>
        </div>
      )}
    </div>
  );
}
