// Shared by Strategist and VenuePlanner so saved Airport observations keep the
// same meaning after Briefing. Missing evidence never becomes normal operations.
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const airportFields = [
  'code', 'name', 'distance_miles', 'status', 'delays', 'conditionsSource', 'busyTimes',
  'faa_delay_minutes', 'faa_has_delays', 'faa_ground_stops', 'faa_delay_reason',
  'faa_closure_status', 'faa_closure_start', 'faa_closure_end', 'faa_supported',
  'faa_source_updated_at', 'faa_fetched_at',
];
const sectionFields = ['busyPeriods', 'recommendations', 'reason', 'summary', 'fetchedAt', 'radiusMiles', 'role'];
const pick = (value, fields) => Object.fromEntries(fields
  .filter(key => value[key] !== undefined).map(key => [key, value[key]]));

/** Preserve source statements and FAA observations without inferring demand. */
export function formatAirportContext(section) {
  if (hasText(section)) return section;
  if (!section || typeof section !== 'object' || Array.isArray(section)) return 'Airport conditions were not reported.';
  if (section._pending) return 'Airport research has not finished.';
  if (section._generationFailed || section.isFallback) {
    return `Airport research failed: ${section.error || section.reason || 'Current conditions are unavailable.'}`;
  }

  const reports = Array.isArray(section.airports)
    ? section.airports : section.code || section.airport_code ? [section] : [];
  const airports = reports.filter(report => report && typeof report === 'object' && !Array.isArray(report))
    .map(report => ({
      ...pick(report, airportFields),
      ...(report.code === undefined && report.airport_code !== undefined ? { code: report.airport_code } : {}),
      status: hasText(report.status) ? report.status : 'unreported',
      ...(!hasText(report.delays) && hasText(report.delay_status) ? { delays: report.delay_status } : {}),
    }));
  const context = { airports, ...pick(section, sectionFields) };
  if (!airports.length && !sectionFields.some(key => hasText(section[key]))) {
    return 'Airport conditions were not reported.';
  }
  return 'Saved airport observations. Null, unreported, unknown, and omitted fields mean unavailable evidence. ' +
    'FAA disruptions take precedence over conflicting research. Scoped restrictions do not mean the entire airport is closed. ' +
    'Do not infer rideshare demand from delays alone.\n' + JSON.stringify(context);
}
