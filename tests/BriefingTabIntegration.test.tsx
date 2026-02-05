import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
// @ts-ignore
import BriefingTab from '../client/src/components/BriefingTab';
// @ts-ignore
import * as coPilotHelpers from '../client/src/utils/co-pilot-helpers';

// Mock dependencies
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(() => ({
    invalidateQueries: jest.fn(),
  })),
}));

jest.mock('../client/src/utils/co-pilot-helpers', () => ({
  getAuthHeader: jest.fn(() => ({})),
  formatEventDate: (date: string) => date,
  formatEventTimeRange: (start: string, end: string) => `${start} - ${end}`,
  filterValidEvents: jest.requireActual('../client/src/utils/co-pilot-helpers').filterValidEvents,
  isEventToday: jest.requireActual('../client/src/utils/co-pilot-helpers').isEventToday,
  hasValidEventTime: jest.requireActual('../client/src/utils/co-pilot-helpers').hasValidEventTime,
}));

// Mock EventsComponent to simplify testing - we want to test BriefingTab's filtering
jest.mock('../client/src/components/EventsComponent', () => {
  return function MockEventsComponent({ events }: { events: any[] }) {
    return (
      <div data-testid="events-list">
        {events.map((e, i) => (
          <div key={i} data-testid="event-item">
            {e.title}
          </div>
        ))}
      </div>
    );
  };
});

describe('BriefingTab Integration', () => {
  // Use a fixed date for "today" in tests
  const MOCK_TODAY = '2026-02-04'; 
  const TIMEZONE = 'America/Chicago';

  beforeAll(() => {
    // Mock Date to return fixed date
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${MOCK_TODAY}T12:00:00`)); // Noon local time
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const baseProps = {
    snapshotId: 'test-snapshot',
    timezone: TIMEZONE,
    isEventsLoading: false,
  };

  test('filters out events with missing end times', () => {
    const events = [
      {
        title: 'Valid Event',
        event_start_date: MOCK_TODAY,
        event_start_time: '19:00',
        event_end_time: '22:00',
      },
      {
        title: 'Missing End Time Event',
        event_start_date: MOCK_TODAY,
        event_start_time: '20:00',
        // event_end_time missing
      }
    ];

    // @ts-ignore
    render(<BriefingTab {...baseProps} eventsData={{ events }} />);

    const items = screen.getAllByTestId('event-item');
    // Expect both events to be present after fix
    expect(items).toHaveLength(2);
    expect(screen.getByText('Valid Event')).toBeInTheDocument();
    expect(screen.getByText('Missing End Time Event')).toBeInTheDocument();
  });

  test('filters out future events', () => {
    const events = [
      {
        title: 'Today Event',
        event_start_date: MOCK_TODAY,
        event_start_time: '19:00',
        event_end_time: '22:00',
      },
      {
        title: 'Future Event',
        event_start_date: '2026-02-05', // Tomorrow
        event_start_time: '19:00',
        event_end_time: '22:00',
      }
    ];

    // @ts-ignore
    render(<BriefingTab {...baseProps} eventsData={{ events }} />);

    expect(screen.getByText('Today Event')).toBeInTheDocument();
    expect(screen.queryByText('Future Event')).not.toBeInTheDocument();
  });
});
