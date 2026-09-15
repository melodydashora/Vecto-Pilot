// Synthetic successful source data. Explicit explanations distinguish empty
// discoveries from pending or failed provider responses.
export function completeBriefing(snapshotId, overrides = {}) {
  return {
    snapshot_id: snapshotId, status: 'complete', generated_at: new Date(),
    weather_current: { temperature: 20, conditions: 'Cloudy' },
    weather_forecast: [{ temperature: 20, conditions: 'Cloudy' }],
    traffic_conditions: { summary: 'No incidents' }, events: { items: [], reason: 'None found' },
    news: { items: [], reason: 'None found' }, school_closures: { items: [], reason: 'None found' },
    airport_conditions: { airports: [], verifiedEmpty: true, reason: 'No nearby airports' },
    holiday: { holiday: 'none', is_holiday: false },
    ...overrides,
  };
}
