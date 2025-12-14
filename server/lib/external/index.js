// server/lib/external/index.js - Barrel exports for external APIs
// Third-party API integrations

// Traffic
export { getTrafficData, analyzeTrafficWithClaude } from './tomtom-traffic.js';

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
// - tomtom-traffic.js: TomTom Traffic API + Claude analysis
// - routes-api.js: Google Routes API (distance, drive time)
// - streetview-api.js: Google Street View images
// - perplexity-api.js: Perplexity search API
// - serper-api.js: Serper search API
// - semantic-search.js: Vector similarity search
// - tts-handler.js: OpenAI TTS integration
// - faa-asws.js: FAA airport status
