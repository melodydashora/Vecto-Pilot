import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
// @ts-ignore
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// @ts-ignore
import StrategyPage from '../client/src/pages/co-pilot/StrategyPage';

// Mock dependencies
jest.mock('../client/src/components/GlobalHeader', () => () => <div data-testid="global-header" />);
jest.mock('../client/src/components/CoachChat', () => () => <div data-testid="coach-chat" />);
jest.mock('../client/src/components/BarsDataGrid', () => () => <div data-testid="bars-data-grid" />);
jest.mock('../client/src/components/SmartBlocksStatus', () => ({
  SmartBlocksStatus: () => <div data-testid="smart-blocks-status" />
}));
jest.mock('../client/src/components/co-pilot/GreetingBanner', () => ({
  GreetingBanner: () => <div data-testid="greeting-banner" />
}));

// Mock LocationContext
jest.mock('../client/src/contexts/location-context-clean', () => ({
  useLocation: () => ({
    currentCoords: { latitude: 33.1507, longitude: -96.8236 },
    city: 'Frisco',
    state: 'TX',
    refreshGPS: jest.fn(),
  }),
}));

// Mock useToast
jest.mock('../client/src/hooks/useToast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

// Mock co-pilot-helpers
jest.mock('../client/src/utils/co-pilot-helpers', () => ({
  logAction: jest.fn(),
  filterHighValueSpacedBlocks: (blocks: any[]) => blocks, // Pass through
}));

// CRITICAL: Mock the useCoPilot hook directly to control data
jest.mock('../client/src/contexts/co-pilot-context', () => ({
  useCoPilot: () => ({
    coords: { latitude: 33.1507, longitude: -96.8236 },
    lastSnapshotId: 'test-snapshot-id',
    strategyData: { status: 'ok' },
    persistentStrategy: 'Test Strategy',
    immediateStrategy: 'Go here now',
    isStrategyFetching: false,
    blocks: [
      {
        name: "Test Venue with Event",
        coordinates: { lat: 33.15, lng: -96.82 },
        placeId: "place-1",
        valueGrade: "A",
        notWorth: false,
        hasEvent: true,
        eventBadge: "Live Music",
        eventSummary: "Local band playing tonight",
        estimatedDistanceMiles: 1.2,
        isOpen: true
      },
      {
        name: "Test Venue No Event",
        coordinates: { lat: 33.16, lng: -96.83 },
        placeId: "place-2",
        valueGrade: "A",
        notWorth: false,
        hasEvent: false,
        estimatedDistanceMiles: 2.0,
        isOpen: true
      }
    ],
    blocksData: { rankingId: 'test-ranking-id' },
    isBlocksLoading: false,
    blocksError: null,
    enrichmentProgress: 100,
    strategyProgress: 100,
    enrichmentPhase: 'complete',
    pipelinePhase: 'complete',
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe('SmartBlock Events Integration', () => {
  beforeAll(() => {
    // Mock IntersectionObserver
    global.IntersectionObserver = class IntersectionObserver {
      constructor(callback: any, options: any) {}
      disconnect() {}
      observe(element: any) {}
      unobserve(element: any) {}
      takeRecords() { return []; }
    } as any;
  });

  afterAll(() => {
    // @ts-ignore
    delete global.IntersectionObserver;
  });

  test('displays event badge on Smart Block when event data is present', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StrategyPage />
      </QueryClientProvider>
    );

    // Check for the first venue
    expect(screen.getByText('Test Venue with Event')).toBeInTheDocument();

    // Check for the event badge text
    expect(screen.getByText(/Event: Live Music/i)).toBeInTheDocument();

    // Check for the second venue
    expect(screen.getByText('Test Venue No Event')).toBeInTheDocument();
  });
});