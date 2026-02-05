import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
// @ts-ignore
import BriefingPage from '../client/src/pages/co-pilot/BriefingPage';
// @ts-ignore
import { useCoPilot } from '../client/src/contexts/co-pilot-context';

// Mock child components to isolate tests
jest.mock('../client/src/components/BriefingTab', () => {
  return function MockBriefingTab(props: any) {
    return (
      // @ts-ignore
      <div data-testid="briefing-tab">
        {/* @ts-ignore */}
        <div data-testid="events-data">{JSON.stringify(props.eventsData)}</div>
        {/* @ts-ignore */}
        <div data-testid="events-loading">{props.isEventsLoading ? 'true' : 'false'}</div>
      </div>
    );
  };
});

// Mock hooks
jest.mock('../client/src/contexts/co-pilot-context', () => {
  return {
    useCoPilot: jest.fn(),
  };
});

describe('BriefingPage Event Display Integration', () => {
  const mockUseCoPilot = useCoPilot as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders events data when available in context', () => {
    const mockEvents = [
      { id: '1', title: 'Test Event 1', venue: 'Test Venue 1', start_time: '2023-10-27T19:00:00' },
      { id: '2', title: 'Test Event 2', venue: 'Test Venue 2', start_time: '2023-10-27T20:00:00' },
    ];

    mockUseCoPilot.mockReturnValue({
      lastSnapshotId: 'test-snapshot-id',
      persistentStrategy: null,
      timezone: 'America/New_York',
      briefingData: {
        weather: null,
        traffic: null,
        news: null,
        events: mockEvents,
        schoolClosures: null,
        airport: null,
        isLoading: {
          weather: false,
          traffic: false,
          events: false,
          airport: false,
        },
      },
    });

    // @ts-ignore
    render(<BriefingPage />);

    const briefingTab = screen.getByTestId('briefing-tab');
    expect(briefingTab).toBeInTheDocument();

    const eventsDataContainer = screen.getByTestId('events-data');
    expect(eventsDataContainer).toHaveTextContent(JSON.stringify({ events: mockEvents }));
  });

  test('handles loading state for events', () => {
    mockUseCoPilot.mockReturnValue({
      lastSnapshotId: 'test-snapshot-id',
      persistentStrategy: null,
      timezone: 'America/New_York',
      briefingData: {
        weather: null,
        traffic: null,
        news: null,
        events: [], // Empty or null while loading
        schoolClosures: null,
        airport: null,
        isLoading: {
          weather: false,
          traffic: false,
          events: true, // Loading is true
          airport: false,
        },
      },
    });

    // @ts-ignore
    render(<BriefingPage />);

    const eventsLoadingContainer = screen.getByTestId('events-loading');
    expect(eventsLoadingContainer).toHaveTextContent('true');
  });

  test('handles null/undefined events gracefully', () => {
    mockUseCoPilot.mockReturnValue({
      lastSnapshotId: 'test-snapshot-id',
      persistentStrategy: null,
      timezone: 'America/New_York',
      briefingData: {
        weather: null,
        traffic: null,
        news: null,
        events: null, // Null events
        schoolClosures: null,
        airport: null,
        isLoading: {
          weather: false,
          traffic: false,
          events: false,
          airport: false,
        },
      },
    });

    // @ts-ignore
    render(<BriefingPage />);

    const eventsDataContainer = screen.getByTestId('events-data');
    // Expect undefined or null based on useMemo logic in BriefingPage
    expect(eventsDataContainer).toBeEmptyDOMElement(); 
  });
});
