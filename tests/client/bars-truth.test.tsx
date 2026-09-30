import React from 'react';
import { jest, test, expect, beforeEach } from '@jest/globals';
import { render, screen, cleanup } from '@testing-library/react';
let state: any;
const useBars = jest.fn((_props: any) => state);
jest.unstable_mockModule('../../client/src/hooks/useBarsQuery', () => ({ useBarsQuery: useBars }));
jest.unstable_mockModule('../../client/src/utils/co-pilot-helpers', () => ({ openNavigation: jest.fn() }));
const { default: BarsMainTab } = await import('../../client/src/components/BarsMainTab');
const { default: BarsDataGrid } = await import('../../client/src/components/BarsDataGrid');
const props = { latitude: 1, longitude: 1, city: 'City', state: 'AA', timezone: 'Asia/Tokyo', isLocationResolved: true, getAuthHeader: () => ({}) };
beforeEach(() => { cleanup(); state = { barsData: { venues: [{ name: 'Fixture Lounge', type: 'bar', expenseLevel: '$$$', expenseRank: 3, isOpen: true, hoursToday: null, closingSoon: true, minutesUntilClose: 0, opensInMinutes: null, crowdLevel: null }], lastCallVenues: [] }, isBarsLoading: false, barsError: null, refetchBars: jest.fn() }; });
test('provider-confirmed open status survives missing localized hours and zero close countdown', () => {
 render(<BarsMainTab {...props} />);
 expect(screen.getByText('Fixture Lounge')).toBeInTheDocument();
 expect(screen.getByText('Open Now')).toBeInTheDocument();
 expect(screen.getByText('Closes in 0min')).toBeInTheDocument();
 expect(screen.queryByText(/crowd/)).not.toBeInTheDocument();
 expect(useBars).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Tokyo', getAuthHeader: props.getAuthHeader }));
});
test('discovery failure renders the error path, not no-venues success', () => {
 state = { ...state, barsData: undefined, barsError: new Error('Fixture outage') };
 render(<BarsMainTab {...props} />);
 expect(screen.queryByText('No venues found')).not.toBeInTheDocument();
 expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
});
test('Strategy compact cards show their actual heuristic grade rather than invent a venue price', () => {
 render(<BarsDataGrid blocks={[{ name: 'Fixture Strategy Venue', category: 'bar', isOpen: true, valueGrade: 'A', valuePerMin: 1, businessHours: 'Monday: 8AM-10PM', coordinates: { lat: 1, lng: 1 } }]} />);
 expect(screen.getByText('Grade A')).toBeInTheDocument(); expect(screen.queryByText('$$$$$')).not.toBeInTheDocument();
});
