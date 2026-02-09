javascript
const PHASE_EXPECTED_DURATIONS = {
  starting: 500,      // Nearly instant
  resolving: 2000,    // Location resolution
  analyzing: 25000,   // Briefing (traffic + events)
  immediate: 3500,    // GPT-5.2 immediate strategy
  venues: 90000,      // VENUE_SCORER role (slowest)
  routing: 2000,      // Google Routes API
  places: 2000,       // Places lookup
  verifying: 1000,    // Event verification
  complete: 0         // Done
};