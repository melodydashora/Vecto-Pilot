import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EventsComponent from '../client/src/components/EventsComponent';

// Synthetic presentation payloads only: the server owns reconciliation, and these
// fixtures do not claim that a real performer, venue, or schedule has been verified.
const date = '2026-09-11';
const timezone = 'America/Chicago';
const original = {
  id: 'concert-report-a',
  title: 'Example Artist: Example Tour',
  venue: 'Example Pavilion',
  event_start_date: date,
  event_end_date: date,
  event_start_time: '18:30',
  event_end_time: '22:00',
};
const otherReport = {
  ...original,
  id: 'concert-report-b',
  title: 'Example Tour: Example Artist with Guest',
  event_end_time: '22:30',
};
const thirdReport = {
  ...original,
  id: 'concert-report-c',
  title: 'Example Artist - Example Tour',
  event_end_time: '22:30',
};
const conflict = {
  ...original,
  subtype: 'concert',
  event_end_time: undefined,
  event_end_conflict: true,
  event_variants: [original, otherReport, thirdReport],
};

describe('EventsComponent reconciled source reports', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-11T17:00:00Z'));
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test('counts a conflicted group once and exposes every original title and end report', () => {
    render(<EventsComponent events={[conflict]} timezone={timezone} />);

    const category = screen.getByTestId('events-category-concerts');
    expect(within(category).getByText('1', { exact: true })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^event-concerts-/)).toHaveLength(1);
    const card = screen.getByTestId('event-concerts-0');
    expect(within(card).getByText('Starts 6:30 PM')).toBeInTheDocument();
    expect(within(card).getByText(/Reported end times disagree/)).toBeVisible();
    expect(within(card).queryByText('6:30 PM - 10:30 PM')).not.toBeInTheDocument();

    const summary = within(card).getByText('Source reports (3)');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    const reports = within(details!).getAllByRole('listitem');
    expect(reports).toHaveLength(3);
    for (const [index, report] of [original, otherReport, thirdReport].entries()) {
      expect(within(reports[index]).getByText(report.title)).toBeVisible();
    }
    expect(within(reports[0]).getByText(`Reported end: ${date} at 10:00 PM`)).toBeVisible();
    expect(within(reports[1]).getByText(`Reported end: ${date} at 10:30 PM`)).toBeVisible();
    expect(within(reports[2]).getByText(`Reported end: ${date} at 10:30 PM`)).toBeVisible();
  });

  test('renders separate supplied starts and unresolved school aliases without client deduplication', () => {
    const laterShow = { ...original, id: 'later-show', subtype: 'concert', event_start_time: '20:00' };
    const schoolA = { ...original, id: 'school-a', title: 'Memorial High School @ Emerson High School', subtype: 'sports' };
    const schoolB = { ...schoolA, id: 'school-b', title: 'Frisco Emerson vs Frisco Memorial' };
    render(<EventsComponent events={[conflict, laterShow, schoolA, schoolB]} timezone={timezone} />);

    expect(screen.getAllByTestId(/^event-concerts-/)).toHaveLength(2);
    expect(screen.getAllByTestId(/^event-sports-/)).toHaveLength(2);
    expect(within(screen.getByTestId('events-category-concerts')).getByText('2', { exact: true })).toBeInTheDocument();
    expect(within(screen.getByTestId('events-category-sports')).getByText('2', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('8:00 PM - 10:00 PM')).toBeVisible();
    expect(screen.getByRole('heading', { name: schoolA.title })).toBeVisible();
    expect(screen.getByRole('heading', { name: schoolB.title })).toBeVisible();
  });

  test('keeps an agreed range with expandable original reports', () => {
    const agreed = {
      ...conflict,
      event_end_time: '22:00',
      event_end_conflict: false,
      event_variants: [original, { ...otherReport, event_end_time: original.event_end_time }],
    };
    render(<EventsComponent events={[agreed]} timezone={timezone} />);

    expect(screen.getByText('6:30 PM - 10:00 PM')).toBeVisible();
    expect(screen.queryByText(/Reported end times disagree/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Source reports (2)'));
    expect(screen.getByText(otherReport.title)).toBeVisible();
  });

  test('labels a missing original end time as omission rather than disagreement', () => {
    render(<EventsComponent events={[{
      ...conflict,
      event_variants: [original, { ...otherReport, event_end_time: undefined }],
    }]} timezone={timezone} />);

    expect(screen.getByText('Starts 6:30 PM')).toBeVisible();
    expect(screen.getByText('Some reports omit an end time. End time is unconfirmed.')).toBeVisible();
    expect(screen.queryByText(/Reported end times disagree/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Source reports (2)'));
    expect(screen.getByText('Reported end: Not reported')).toBeVisible();
    expect(screen.getByText(`Reported end: ${date} at 10:00 PM`)).toBeVisible();
  });

  test.each([
    ['10:00 pm', 'Some reports omit an end time. End time is unconfirmed.'],
    ['22:30', 'Reported end times disagree, and some reports omit an end time. End time is unconfirmed.'],
  ])('distinguishes equivalent known ends from differing ends when a report is missing (%s)', (otherEnd, message) => {
    render(<EventsComponent events={[{
      ...conflict,
      event_variants: [original, { ...otherReport, event_end_time: otherEnd }, { ...thirdReport, event_end_time: undefined }],
    }]} timezone={timezone} />);

    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByText('Starts 6:30 PM')).toBeVisible();
    fireEvent.click(screen.getByText('Source reports (3)'));
    expect(screen.getByText('Reported end: Not reported')).toBeVisible();
  });

  test('keeps a conflicted group when one original report passes date/time filtering', () => {
    render(<EventsComponent events={[{
      ...conflict,
      event_variants: [{ ...original, event_start_time: 'TBD' }, otherReport],
    }]} timezone={timezone} />);

    expect(screen.getByTestId('event-concerts-0')).toBeVisible();
    expect(screen.getByText(/End time is unconfirmed/)).toBeVisible();
    expect(screen.queryByText('No events found with valid times')).not.toBeInTheDocument();
  });

  test('filters a group if all originals are past, even when its top-level date looks current', () => {
    const expiredDate = '2026-09-10';
    render(<EventsComponent events={[{
      ...conflict,
      event_variants: [original, otherReport].map(report => ({
        ...report, event_start_date: expiredDate, event_end_date: expiredDate,
      })),
    }]} timezone={timezone} />);

    expect(screen.queryByTestId('events-component')).not.toBeInTheDocument();
    expect(screen.getByText('No events found with valid times')).toBeInTheDocument();
  });

  test('keeps a group when a future original remains eligible alongside an expired report', () => {
    render(<EventsComponent events={[{
      ...conflict,
      event_variants: [
        { ...original, event_start_date: '2026-09-10', event_end_date: '2026-09-10' },
        { ...otherReport, event_start_date: '2026-09-12', event_end_date: '2026-09-12' },
      ],
    }]} timezone={timezone} />);

    expect(screen.getByTestId('event-concerts-0')).toBeVisible();
    fireEvent.click(screen.getByText('Source reports (2)'));
    expect(screen.getByText('Reported end: 2026-09-10 at 10:00 PM')).toBeVisible();
    expect(screen.getByText('Reported end: 2026-09-12 at 10:30 PM')).toBeVisible();
  });

  test('retains timezone-aware filtering for originals near the local day boundary', () => {
    jest.setSystemTime(new Date('2026-09-12T02:00:00Z')); // Still September 11 in Chicago.
    render(<EventsComponent events={[conflict]} timezone={timezone} />);

    expect(screen.getByTestId('event-concerts-0')).toBeVisible();
    expect(screen.getByText(/^Today \(/)).toBeVisible();
  });
});
