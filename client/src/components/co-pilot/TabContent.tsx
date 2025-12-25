/**
 * TabContent - Unified tab content rendering for Co-Pilot
 *
 * This component handles the conditional rendering of all tab content,
 * keeping the main co-pilot.tsx file clean and focused on strategy logic.
 */

import { MapPin, Wine } from 'lucide-react';
import type { TabType, SmartBlock } from '@/types/co-pilot';
import BriefingTab from '@/components/BriefingTab';
import MapTab from '@/components/MapTab';
import { DonationTab } from '@/components/DonationTab';
import RideshareIntelTab from '@/components/RideshareIntelTab';
import BarTab from '@/components/BarTab';
import { getAuthHeader } from '@/utils/co-pilot-helpers';

// Event type for MapTab
interface MapEvent {
  title: string;
  venue?: string;
  address?: string;
  event_date?: string;
  event_time?: string;
  event_end_time?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  subtype?: string;
}

// Briefing event type
interface BriefingEvent {
  event_date?: string;
  event_type?: string;
  subtype?: string;
  title?: string;
  venue?: string;
  location?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  impact?: 'high' | 'medium' | 'low';
  [key: string]: unknown;
}

export interface TabContentProps {
  activeTab: TabType;

  // Location data
  coords: { latitude: number; longitude: number } | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isLocationResolved: boolean;

  // Snapshot data
  snapshotId: string | null;

  // Strategy data
  blocks: SmartBlock[];
  isLoading: boolean;
  persistentStrategy: string | null;

  // Briefing data
  weatherData?: unknown;
  trafficData?: unknown;
  newsData?: unknown;
  eventsData?: { events?: BriefingEvent[]; reason?: string };
  schoolClosuresData?: unknown;
  airportData?: unknown;
}

export function TabContent({
  activeTab,
  coords,
  city,
  state,
  timezone,
  isLocationResolved,
  snapshotId,
  blocks,
  isLoading,
  persistentStrategy,
  weatherData,
  trafficData,
  newsData,
  eventsData,
  schoolClosuresData,
  airportData,
}: TabContentProps) {
  // Don't render anything for the strategy tab - it's handled in co-pilot.tsx
  if (activeTab === 'strategy') {
    return null;
  }

  return (
    <>
      {/* Briefing Tab Content */}
      {activeTab === 'briefing' && (
        <div data-testid="briefing-section" className="mb-24">
          <BriefingTab
            snapshotId={snapshotId || undefined}
            weatherData={weatherData}
            trafficData={trafficData}
            newsData={newsData}
            eventsData={eventsData}
            schoolClosuresData={schoolClosuresData}
            airportData={airportData}
            consolidatedStrategy={persistentStrategy || undefined}
          />
        </div>
      )}

      {/* Map Tab Content */}
      {activeTab === 'map' && (
        <div data-testid="map-section" className="mb-24">
          {coords && snapshotId ? (
            <MapTab
              driverLat={coords.latitude}
              driverLng={coords.longitude}
              venues={blocks.map((block, idx) => ({
                id: `${idx}`,
                name: block.name,
                lat: block.coordinates.lat,
                lng: block.coordinates.lng,
                distance_miles: block.estimated_distance_miles,
                drive_time_min: block.driveTimeMinutes || block.estimatedWaitTime,
                est_earnings_per_ride: block.estimated_earnings,
                rank: idx + 1,
                value_grade: block.value_grade,
              }))}
              events={eventsData?.events?.map((e: BriefingEvent): MapEvent => ({
                title: e.title as string,
                venue: e.venue as string | undefined,
                address: e.address as string | undefined,
                event_date: e.event_date as string | undefined,
                event_time: e.event_time as string | undefined,
                event_end_time: e.event_end_time as string | undefined,
                latitude: e.latitude as number | undefined,
                longitude: e.longitude as number | undefined,
                impact: e.impact as 'high' | 'medium' | 'low' | undefined,
                subtype: e.subtype as string | undefined,
              })) || []}
              snapshotId={snapshotId}
              isLoading={isLoading}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MapPin className="w-12 h-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-700">Map & Venues</h3>
              <p className="text-gray-500 mt-2">Generate recommendations to view them on the map</p>
            </div>
          )}
        </div>
      )}

      {/* Rideshare Intelligence Tab Content */}
      {activeTab === 'rideshare' && (
        <div data-testid="rideshare-section">
          <RideshareIntelTab />
        </div>
      )}

      {/* Donation/About Tab Content */}
      {activeTab === 'donation' && (
        <div data-testid="donation-section" className="mb-24">
          <DonationTab userId={localStorage.getItem('vecto_user_id') || 'default'} />
        </div>
      )}

      {/* Bar Tab - Premium Venues */}
      {activeTab === 'venues' && coords && (
        <div data-testid="bar-tab-section">
          <BarTab
            latitude={coords.latitude}
            longitude={coords.longitude}
            city={city}
            state={state}
            timezone={timezone}
            isLocationResolved={isLocationResolved}
            getAuthHeader={getAuthHeader}
          />
        </div>
      )}

      {activeTab === 'venues' && !coords && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Wine className="w-12 h-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">Location Required</h3>
          <p className="text-gray-500 mt-2">Enable location services to discover nearby bars and venues</p>
        </div>
      )}
    </>
  );
}

export default TabContent;
