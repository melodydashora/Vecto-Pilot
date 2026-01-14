// server/lib/external/index.js - Barrel exports for external APIs
// Third-party API integrations

// Traffic
// 2026-01-14: Moved to server/lib/traffic/tomtom.js - re-export for backwards compatibility
export { getTomTomTraffic, getTomTomTrafficForCity, fetchRawTraffic } from '../traffic/tomtom.js';

// Google APIs
export { calculateRoutes } from './routes-api.js';
export { getStreetViewImage } from './streetview-api.js';

// AI/Search APIs
export { searchPerplexity } from './perplexity-api.js';
export { searchSerper } from './serper-api.js';
export { semanticSearch } from './semantic-search.js';

// Voice
export { synthesizeSpeech } from './tts-handler.js';

// Aviation
export { getFAAStatus } from './faa-asws.js';

// Module summary:
// - TomTom: Moved to server/lib/traffic/tomtom.js (re-exported here for backwards compat)
// - routes-api.js: Google Routes API (distance, drive time)
// - streetview-api.js: Google Street View images
// - perplexity-api.js: Perplexity search API
// - serper-api.js: Serper search API
// - semantic-search.js: Vector similarity search
// - tts-handler.js: OpenAI TTS integration
// - faa-asws.js: FAA airport status
