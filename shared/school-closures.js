// One date-only calendar rule for Schools ingestion, planners, and the card.
function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Resolve a complete, real calendar interval without inferring missing dates.
 * Explicit student return dates are exclusive. Legacy end dates describe the
 * last closed day and remain inclusive when there is no explicit return date.
 * Invalid records return null; ingestion must reject them before filtering.
 */
export function getSchoolClosureInterval(closure) {
  if (!closure || typeof closure !== 'object' || Array.isArray(closure)) return null;
  const startDate = closure.start_date ?? closure.closureStart ?? closure.startDate ?? closure.closure_date ?? closure.date;
  const reopeningDate = closure.reopening_date ?? closure.reopeningDate;
  const endExclusive = reopeningDate != null;
  const endDate = endExclusive ? reopeningDate : closure.end_date ?? closure.endDate;
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return null;
  if (endExclusive ? endDate <= startDate : endDate < startDate) return null;
  // The card leads with the inclusive closure period. Calendar arithmetic uses
  // UTC so browser timezone and daylight-saving changes cannot shift its dates.
  let closedThroughDate = endDate;
  if (endExclusive) {
    const lastClosed = new Date(`${endDate}T00:00:00.000Z`);
    lastClosed.setUTCDate(lastClosed.getUTCDate() - 1);
    closedThroughDate = lastClosed.toISOString().slice(0, 10);
  }
  return { startDate, endDate, endExclusive, closedThroughDate };
}

/**
 * Today's travel context: a closed day or the explicitly verified student return
 * day. A legacy last-closed date cannot establish a return day. Ignore any stored
 * status so yesterday's snapshot cannot label returning students as still closed.
 */
export function getSchoolClosureStatusOnDate(closure, today) {
  if (!isCalendarDate(today)) return null;
  const interval = getSchoolClosureInterval(closure);
  if (!interval || today < interval.startDate) return null;
  if (interval.endExclusive && today === interval.endDate) return 'reopening_today';
  return today <= interval.closedThroughDate ? 'closed' : null;
}

/** Return whether students are still on break, excluding their return day. */
export function isSchoolClosureActiveOnDate(closure, today) {
  return getSchoolClosureStatusOnDate(closure, today) === 'closed';
}
