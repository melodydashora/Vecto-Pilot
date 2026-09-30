// Market identity has one resolver shared by location, venues and Briefing.
// Never substitute a city for a market or discard a supplied country/state.
import { resolveTimezoneFromMarket } from '../../location/resolveTimezone.js';
export async function getMarketForLocation(city, state, country) {
  return (await resolveTimezoneFromMarket(city, state, country))?.market_name || null;
}
