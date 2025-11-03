import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, MapPin, Globe, Cloud, Radio, Calendar, Shield, Link as LinkIcon, ArrowLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';

export default function BriefingPage() {
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  
  useEffect(() => {
    const handleSnapshot = (e: any) => {
      setSnapshotId(e.detail.snapshotId);
    };
    
    window.addEventListener('vecto-snapshot-saved', handleSnapshot);
    return () => window.removeEventListener('vecto-snapshot-saved', handleSnapshot);
  }, []);

  // Fetch briefing data from new endpoint
  const { data: briefingData, isLoading, error } = useQuery({
    queryKey: ['/api/strategy/briefing', snapshotId],
    queryFn: async () => {
      if (!snapshotId) return null;
      const response = await fetch(`/api/strategy/briefing/${snapshotId}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch briefing');
      }
      return response.json();
    },
    enabled: !!snapshotId,
    staleTime: 60000,
  });

  if (isLoading) {
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
          <p className="text-sm text-gray-600">Error loading briefing</p>
        </div>
      </div>
    );
  }

  if (!briefingData || !briefingData.briefing) {
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

  const briefing = briefingData.briefing;

  const hasContent = briefing.tactical_traffic || briefing.tactical_closures || briefing.tactical_enforcement ||
    briefing.global_travel || briefing.domestic_travel || briefing.local_traffic || 
    briefing.weather_impacts || briefing.events_nearby || briefing.rideshare_intel;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header with back link */}
      <div className="mb-6">
        <Link href="/co-pilot" data-testid="link-back-to-copilot">
          <a className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" />
            Back to Co-Pilot
          </a>
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Rideshare Briefing</h1>
        <p className="text-sm text-gray-600">Comprehensive intelligence from Perplexity AI + GPT-5 tactical analysis</p>
      </div>

      {!hasContent && (
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="py-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-gray-600">Briefing data is being generated...</p>
            <p className="text-xs text-gray-500 mt-1">This may take a few moments</p>
          </CardContent>
        </Card>
      )}

      {/* GPT-5 Tactical 30-Minute Intelligence */}
      {(briefing.tactical_traffic || briefing.tactical_closures || briefing.tactical_enforcement) && (
        <Card data-testid="section-tactical" className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-600" />
              Next 30 Minutes (GPT-5 Live Analysis)
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white space-y-4">
            {briefing.tactical_traffic && (
              <div data-testid="tactical-traffic">
                <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-orange-600" /> Traffic & Incidents
                </h4>
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.tactical_traffic}</p>
              </div>
            )}
            
            {briefing.tactical_closures && (
              <div data-testid="tactical-closures" className="pt-4 border-t border-gray-100">
                <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600" /> Closures & Construction
                </h4>
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.tactical_closures}</p>
              </div>
            )}
            
            {briefing.tactical_enforcement && (
              <div data-testid="tactical-enforcement" className="pt-4 border-t border-gray-100">
                <h4 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600" /> Enforcement Activity
                </h4>
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.tactical_enforcement}</p>
              </div>
            )}
            
            {briefing.tactical_sources && (
              <div data-testid="tactical-sources" className="pt-4 border-t border-gray-100">
                <h4 className="font-semibold text-xs text-gray-600 mb-2 flex items-center gap-2">
                  <LinkIcon className="w-3 h-3" /> Sources Checked
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{briefing.tactical_sources}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Perplexity Comprehensive Research */}
      {briefing.global_travel && (
        <Card data-testid="section-global" className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              Global Travel Conditions
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.global_travel}</p>
          </CardContent>
        </Card>
      )}

      {briefing.domestic_travel && (
        <Card data-testid="section-domestic" className="border-purple-200 bg-purple-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-purple-600" />
              Domestic Travel
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.domestic_travel}</p>
          </CardContent>
        </Card>
      )}

      {briefing.local_traffic && (
        <Card data-testid="section-local-traffic" className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-orange-600" />
              Local Traffic (Background)
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.local_traffic}</p>
          </CardContent>
        </Card>
      )}

      {briefing.weather_impacts && (
        <Card data-testid="section-weather" className="border-cyan-200 bg-cyan-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-cyan-600" />
              Weather Impacts
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.weather_impacts}</p>
          </CardContent>
        </Card>
      )}

      {briefing.events_nearby && (
        <Card data-testid="section-events" className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-green-600" />
              Events Nearby (50 miles)
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.events_nearby}</p>
          </CardContent>
        </Card>
      )}

      {briefing.holidays && (
        <Card data-testid="section-holidays" className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🎉 Holidays
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.holidays}</p>
          </CardContent>
        </Card>
      )}

      {briefing.rideshare_intel && (
        <Card data-testid="section-rideshare" className="border-indigo-200 bg-indigo-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-indigo-600" />
              Rideshare Intelligence
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{briefing.rideshare_intel}</p>
          </CardContent>
        </Card>
      )}

      {briefing.citations && briefing.citations.length > 0 && (
        <div className="text-xs text-gray-500 pt-4">
          <p className="font-semibold mb-2">Sources:</p>
          <ul className="space-y-1">
            {briefing.citations.map((url: string, idx: number) => (
              <li key={idx}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
