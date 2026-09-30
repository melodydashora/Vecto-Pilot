// 2026-09-10: Preserve observed FAA facts in the legacy snapshot consumer.
// A nearby airport is still useful when FAA is unavailable; proximity does not
// establish zero delay, normal operations, or an airport-wide closure.
export function buildAirportContext(nearbyAirport, airportData = null) {
  if (!nearbyAirport) return null;
  const closure = airportData?.closure_status ?? 'unknown';
  return {
    airport_code: nearbyAirport.code,
    airport_name: nearbyAirport.name,
    distance_miles: Number(nearbyAirport.distance.toFixed(1)),
    delay_minutes: airportData?.delay_minutes ?? null,
    delay_reason: airportData?.delay_reason ?? null,
    closure_status: closure,
    has_delays: airportData?.has_delays ?? null,
    // Restrictions retain their scope in closure_status/reason. A ground stop
    // is not evidence that the entire airport is closed.
    has_closures: closure === 'closed' || closure === 'restricted' ? true : closure === 'open' ? false : null,
    ground_stops: airportData?.ground_stops ?? [],
    ground_delay_programs: airportData?.ground_delay_programs ?? [],
    closure_start: airportData?.closure_start ?? null,
    closure_end: airportData?.closure_end ?? null,
    faa_supported: airportData?.supported ?? null,
    faa_source_updated_at: airportData?.source_updated_at ?? null,
    faa_fetched_at: airportData?.fetched_at ?? null,
    weather: airportData?.weather ? {
      temperature: airportData.weather.temperature,
      conditions: airportData.weather.conditions,
      wind: airportData.weather.wind
    } : null
  };
}
