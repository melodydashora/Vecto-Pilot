import React from 'react';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { act, render, screen, cleanup, within } from '@testing-library/react';
import { SchoolClosuresCard } from '@/components/briefing/SchoolClosuresCard';

const active = {
  schoolName: 'Current district', closureStart: '2026-10-09', reopeningDate: '2026-10-14',
  type: 'district' as const, impact: 'high' as const, reason: 'Fall break',
};

beforeEach(() => {
  jest.useFakeTimers();
  // Sunday evening in Chicago; UTC and Tokyo have already reached Monday.
  jest.setSystemTime(new Date('2026-10-12T04:30:00Z'));
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

describe('Schools card calendar contract', () => {
  it('updates across local midnight and phone resume without new props or a research call', () => {
    jest.setSystemTime(new Date('2026-10-14T04:59:30Z')); // Still October 13 in Chicago.
    render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: [active] }} />);
    expect(screen.getByText('Students return: Oct 14, 2026')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(screen.getByText('Students return today')).toBeInTheDocument();
    expect(screen.queryByText('Students return: Oct 14, 2026')).not.toBeInTheDocument();
    // A suspended phone resumes on the following local day, before its next tick.
    jest.setSystemTime(new Date('2026-10-15T05:00:00Z'));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(screen.queryByText('Current district')).not.toBeInTheDocument();
    expect(screen.queryByText('Students return today')).not.toBeInTheDocument();
  });

  it('shows ongoing breaks and returning students while omitting future breaks and past returns', () => {
    render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: [active,
        { ...active, schoolName: 'Future district', closureStart: '2026-10-12', reopeningDate: '2026-10-19' },
        { ...active, schoolName: 'Returning district', reopeningDate: '2026-10-11', end_date: '2026-10-14' },
        { ...active, schoolName: 'Returned district', reopeningDate: '2026-10-10' },
      ] }} />);
    expect(screen.getByText('Current district')).toBeInTheDocument();
    expect(screen.getByText('Closed: Oct 9, 2026 – Oct 13, 2026')).toBeInTheDocument();
    expect(screen.getByText('Students return: Oct 14, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Future district')).not.toBeInTheDocument();
    expect(screen.getByText('Returning district')).toBeInTheDocument();
    expect(screen.getByText('Students return today')).toBeInTheDocument();
    expect(screen.getByText('Closed: Oct 9, 2026 – Oct 10, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Returned district')).not.toBeInTheDocument();
  });

  it('uses the snapshot day to distinguish still closed, returning today, and the day after', () => {
    const data = { school_closures: [{ ...active, reopeningDate: '2026-10-12' }] };
    const { rerender } = render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={data} />);
    expect(screen.getByText('Current district')).toBeInTheDocument();
    expect(screen.getByText('Students return: Oct 12, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Students return today')).not.toBeInTheDocument();
    rerender(<SchoolClosuresCard timezone="Asia/Tokyo" isSchoolClosuresLoading={false} schoolClosuresData={data} />);
    expect(screen.getByText('Current district')).toBeInTheDocument();
    expect(screen.getByText('Students return today')).toBeInTheDocument();
    expect(screen.getByText('Closed: Oct 9, 2026 – Oct 11, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Students return: Oct 12, 2026')).not.toBeInTheDocument();
    jest.setSystemTime(new Date('2026-10-13T04:30:00Z'));
    rerender(<SchoolClosuresCard timezone="Asia/Tokyo" isSchoolClosuresLoading={false} schoolClosuresData={data} />);
    expect(screen.queryByText('Current district')).not.toBeInTheDocument();
    expect(screen.getByText('No school closures reported for today')).toBeInTheDocument();
  });

  it('recomputes every saved status from calendar dates instead of trusting stale status', () => {
    const rows = [
      { ...active, schoolName: 'Still closed', status: 'reopening_today' },
      { ...active, schoolName: 'Returning now', reopeningDate: '2026-10-11', status: 'closed' },
      { ...active, schoolName: 'Already returned', reopeningDate: '2026-10-10', status: 'reopening_today' },
    ];
    render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: rows }} />);
    expect(within(screen.getByTestId('closure-district-0')).queryByText('Students return today')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('closure-district-0')).getByText('Students return: Oct 14, 2026')).toBeInTheDocument();
    expect(within(screen.getByTestId('closure-district-1')).getByText('Students return today')).toBeInTheDocument();
    expect(screen.queryByText('Already returned')).not.toBeInTheDocument();
  });

  it('supports normalized fields and labels an inclusive legacy last-closed date accurately', () => {
    const data = { school_closures: [{ school_name: 'Legacy district', start_date: '2026-10-09',
      end_date: '2026-10-11', type: 'district' as const, impact: 'medium' as const, closure_reason: 'Calendar break' }] };
    const { rerender } = render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={data} />);
    expect(screen.getByText('Legacy district')).toBeInTheDocument();
    expect(screen.getByText('Calendar break')).toBeInTheDocument();
    expect(screen.getByText('Closed: Oct 9, 2026 – Oct 11, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Students return/)).not.toBeInTheDocument();
    jest.setSystemTime(new Date('2026-10-12T18:00:00Z'));
    rerender(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false} schoolClosuresData={data} />);
    expect(screen.queryByText('Legacy district')).not.toBeInTheDocument();
    expect(screen.queryByText(/Students return/)).not.toBeInTheDocument();
  });

  it.each([
    ['2027-01-01', '2026-12-31', '2026-12-31T18:00:00Z', 'Dec 31, 2026', 'Jan 1, 2027'],
    ['2028-03-01', '2028-02-29', '2028-02-29T18:00:00Z', 'Feb 29, 2028', 'Mar 1, 2028'],
    ['2026-11-02', '2026-11-01', '2026-11-01T18:00:00Z', 'Nov 1, 2026', 'Nov 2, 2026'],
  ])('shows a single closed day correctly before student return %s', (reopeningDate, closureStart, now, closedLabel, returnLabel) => {
    jest.setSystemTime(new Date(now));
    render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: [{ ...active, closureStart, reopeningDate }] }} />);
    expect(screen.getByText(`Closed: ${closedLabel}`)).toBeInTheDocument();
    expect(screen.getByText(`Students return: ${returnLabel}`)).toBeInTheDocument();
  });

  it.each([undefined, null, 'Invalid/Timezone'])('shows unavailable for timezone %s without a false empty state', timezone => {
    render(<SchoolClosuresCard timezone={timezone} isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: [active] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('location timezone is missing or invalid');
    expect(screen.queryByText('No school closures reported for today')).not.toBeInTheDocument();
  });

  it('shows invalid saved dates as unavailable rather than no closures', () => {
    render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: [{ ...active, closureStart: '2026-02-30' }] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('School closure dates could not be verified');
    expect(screen.queryByText('No school closures reported for today')).not.toBeInTheDocument();
  });

  it('preserves pending, failed, missing, and verified-empty states', () => {
    const { rerender } = render(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ _pending: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading school closures');
    rerender(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading
      schoolClosuresData={{ _pending: true, _generationFailed: true, reason: 'Provider unavailable' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(screen.queryByText('Loading school closures...')).not.toBeInTheDocument();
    rerender(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for school closure information');
    rerender(<SchoolClosuresCard timezone="America/Chicago" isSchoolClosuresLoading={false}
      schoolClosuresData={{ school_closures: [], reason: 'No verified closures today' }} />);
    expect(screen.getByText('No verified closures today')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
