
// server/lib/__mocks__/llm-responses.js
// Mock LLM responses for offline development and testing

export const mockStrategies = {
  frisco_morning: {
    minstrategy: "Position near Dallas North Tollway and 121 for morning airport runs. Stage at Legacy West for business district pickups.",
    consolidated: "Today is Monday, November 15, 2025 at 6:30 AM. Clear skies, 69°F. Best strategy: Dallas North Tollway corridor for airport-bound riders heading to DFW. Stage near Legacy West to capture business commuters. Monitor DNT southbound for surge pricing opportunities."
  },
  dallas_evening: {
    minstrategy: "Focus on Uptown and Deep Ellum for evening entertainment demand. Position near DART stations for event traffic.",
    consolidated: "Today is Friday, November 15, 2025 at 7:00 PM. Perfect weather for nightlife. Target Uptown bars and Deep Ellum venues. Stage near Klyde Warren Park to intercept downtown-to-entertainment district traffic."
  }
};

export const mockBriefings = {
  default: {
    global_travel: "No major TSA delays nationwide.",
    domestic_travel: "DFW airport experiencing normal operations.",
    local_traffic: "DNT southbound moderate congestion near Legacy.",
    weather_impacts: "Clear conditions, no weather-related delays.",
    events_nearby: "Dallas Mavericks game at 7:30 PM (American Airlines Center).",
    holidays: "No holidays today.",
    rideshare_intel: "Elevated demand expected near AAC for game traffic.",
    citations: ["https://example.com/traffic", "https://example.com/events"]
  }
};

export function getMockLLMResponse(provider, context) {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Mock LLM responses only available in development');
  }
  
  return mockStrategies.frisco_morning;
}
