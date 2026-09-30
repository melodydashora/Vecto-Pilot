// Shared by the progressive writer and SSE listener; importing channel names
// must not initialize generation, model or database services.
export const CHANNELS = Object.freeze({
  WEATHER: 'briefing_weather_ready',
  TRAFFIC: 'briefing_traffic_ready',
  EVENTS: 'briefing_events_ready',
  AIRPORT: 'briefing_airport_ready',
  NEWS: 'briefing_news_ready',
  SCHOOL_CLOSURES: 'briefing_school_closures_ready',
  HOLIDAY: 'briefing_holiday_ready',
});
