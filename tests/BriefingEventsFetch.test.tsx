import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
// @ts-ignore
import BriefingPage from '../client/src/pages/co-pilot/BriefingPage';
// @ts-ignore
import { CoPilotProvider } from '../client/src/contexts/co-pilot-context';
// @ts-ignore
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock child components to isolate tests, except BriefingTab which we want to test
jest.mock('../client/src/components/BriefingTab', () => {
  return jest.requireActual('../client/src/components/BriefingTab');
});

// Mock GlobalHeader (used by CoPilotLayout which isn't here, but good practice)
jest.mock('../client/src/components/GlobalHeader', () => () => <div data-testid="global-header" />);

// Mock LocationContext
jest.mock('../client/src/contexts/location-context-clean', () => ({
  useLocation: () => ({
    currentCoords: { latitude: 33.1507, longitude: -96.8236 },
    city: 'Frisco',
    state: 'TX',
    timeZone: 'America/Chicago',
    isLocationResolved: true,
    lastSnapshotId: 'test-snapshot-id',
  }),
}));

// Mock utils
jest.mock('../client/src/utils/co-pilot-helpers', () => ({
  getAuthHeader: () => ({ Authorization: 'Bearer mock-token' }),
  subscribeStrategyReady: () => () => {},
  subscribeBlocksReady: () => () => {},
  subscribeBriefingReady: () => () => {},
  subscribePhaseChange: () => () => {},
  filterValidEvents: jest.requireActual('../client/src/utils/co-pilot-helpers').filterValidEvents,
  isEventToday: jest.requireActual('../client/src/utils/co-pilot-helpers').isEventToday,
  hasValidEventTime: jest.requireActual('../client/src/utils/co-pilot-helpers').hasValidEventTime,
  formatEventDate: (d: any) => d,
  formatEventTime: (t: any) => t,
  formatEventTimeRange: (s: any, e: any) => `${s} - ${e}`,
}));

// Setup QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe('BriefingPage Integration - Events Fetch', () => {
  const MOCK_TODAY = '2026-02-04';
  const TIMEZONE = 'America/Chicago';

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${MOCK_TODAY}T12:00:00`)); // Noon local time

    // Mock global fetch
    global.fetch = jest.fn((url) => {
      // Mock Snapshot fetch
      if (url.toString().includes('/api/snapshot/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            snapshot_id: 'test-snapshot-id',
            city: 'Frisco',
            timezone: TIMEZONE,
            status: 'ready'
          })
        });
      }
      
      // Mock Strategy fetch
      if (url.toString().includes('/api/blocks/strategy/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'ok',
            strategy: {}
          })
        });
      }

      // Mock Blocks fetch
      if (url.toString().includes('/api/blocks-fast')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            blocks: [],
            rankingId: 'test-ranking-id'
          })
        });
      }

      // Mock Events fetch (The core of this test)
      if (url.toString().includes('/api/briefing/events/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            events: [
              {
                title: "Dallas Stars vs. St. Louis Blues",
                venue: "American Airlines Center",
                event_start_date: MOCK_TODAY,
                event_start_time: "19:30",
                // No event_end_time to test the fix
                impact: "high"
              },
              {
                title: "Local Concert",
                venue: "The Kessler",
                event_start_date: MOCK_TODAY,
                event_start_time: "20:00",
                event_end_time: "23:00",
                impact: "medium"
              }
            ],
            timestamp: new Date().toISOString()
          })
        });
      }

      // Mock other briefing endpoints to return empty
      if (url.toString().includes('/api/briefing/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      }
      
      // Mock Bars fetch
      if (url.toString().includes('/api/venues/nearby')) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ venues: [] })
        });
      }

      return Promise.reject(new Error(`Unhandled mock url: ${url}`));
    }) as jest.Mock;
  });

  afterAll(() => {
    jest.useRealTimers();
    (global.fetch as jest.Mock).mockClear();
  });

  test('fetches and displays events including those without end times', async () => {
    // @ts-ignore
    render(
      <QueryClientProvider client={queryClient}>
        <CoPilotProvider>
            <BriefingPage />
        </CoPilotProvider>
      </QueryClientProvider>
    );

    // Wait for the specific events to appear
    await waitFor(() => {
      expect(screen.getByText(/Dallas Stars vs. St. Louis Blues/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Local Concert/i)).toBeInTheDocument();
    expect(screen.getByText(/American Airlines Center/i)).toBeInTheDocument();
  });
});
