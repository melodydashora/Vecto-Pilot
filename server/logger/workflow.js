/**
 * Workflow-Aware Logging Utility
 *
 * VISUAL LOG DESIGN:
 * Each log line shows [SECTION ICON] message [OPERATION ICON]
 * - LEFT icon = Which workflow section (TRIAD, VENUES, BRIEFING)
 * - RIGHT icon = What operation type (AI call, API call, DB, etc.)
 *
 * Example output:
 *   🎯 [TRIAD 1/4] Calling strategist                    ← 🤖
 *   🎯 [TRIAD 1/4] ✅ Strategist complete (2341ms)       ← 🤖
 *   🏢 [VENUES 2/4] Calculating routes                   ← 🌐
 *   🏢 [VENUES 3/4] Fetching place details               ← 🌐
 *   📰 [BRIEFING 1/3] Fetching traffic                   ← 🌐
 *   💾 [DB] Saved strategy                               ← 💾
 *
 * WORKFLOW STAGES:
 *
 * 1. LOCATION RESOLUTION (Header/User Context)
 *    [LOCATION 1/3] GPS coordinates received
 *    [LOCATION 2/3] Geocoding/cache lookup
 *    [LOCATION 3/3] Weather + air quality fetched
 *
 * 2. SNAPSHOT CREATION
 *    [SNAPSHOT 1/2] Creating snapshot record
 *    [SNAPSHOT 2/2] Enrichment (airport, holiday)
 *
 * 3. STRATEGY PIPELINE (TRIAD)
 *    [TRIAD 1/4 - STRATEGY_CORE] Core strategic analysis
 *    [TRIAD 2/4 - STRATEGY_CONTEXT] Events/traffic/news gathering
 *    [TRIAD 3/4 - STRATEGY_TACTICAL] Immediate strategy synthesis
 *    [TRIAD 4/4 - SmartBlocks] Venue planning + enrichment
 *
 * 4. SMARTBLOCKS (Venue Pipeline)
 *    [VENUES 1/4] VENUE_SCORER role
 *    [VENUES 2/4] Google Routes API (distances)
 *    [VENUES 3/4] Google Places API (hours/status)
 *    [VENUES 4/4] DB store
 *
 * 5. BRIEFING (Events/News)
 *    [BRIEFING 1/3] Traffic analysis
 *    [BRIEFING 2/3] Events discovery
 *    [BRIEFING 3/3] Event validation
 *
 * 6. EVENTS ETL (Event Discovery Pipeline)
 *    [EVENTS 1/5 - Extract|Providers] Provider calls (SerpAPI, Gemini, Claude)
 *    [EVENTS 2/5 - Transform|Normalize] normalizeEvent + validateEvent
 *    [EVENTS 3/5 - Transform|Geocode] Geocode + venue linking
 *    [EVENTS 4/5 - Load|Store] Upsert to discovered_events (event_hash dedup)
 *    [EVENTS 5/5 - Assemble|Briefing] Query from DB + shape for briefings
 */

/**
 * OPERATION TYPE ICONS (right side - shows what kind of call)
 * Used to quickly identify the nature of each operation in logs
 */
export const OP = {
  AI: '🤖',      // AI model call (Claude, GPT, Gemini)
  API: '🌐',     // External API call (Google, weather, etc.)
  DB: '💾',      // Database operation
  SSE: '📡',     // Server-sent event
  CACHE: '⚡',   // Cache hit/operation
  RETRY: '🔄',   // Retry operation
  FALLBACK: '🔀', // Fallback to alternate
  VALIDATE: '✓', // Validation operation
  NORMALIZE: '⚙️', // Normalization/transform operation
  HASH: '#️⃣',    // Hashing operation
};

/**
 * Workflow components with their phases
 *
 * SECTION ICON REFERENCE (left side - shows workflow section):
 *   📍 LOCATION  - GPS, geocoding, header resolution
 *   👤 USER      - User table, auth, device tracking
 *   📸 SNAPSHOT  - Snapshot creation and enrichment
 *   🎯 TRIAD     - Main strategy pipeline orchestration
 *   📰 BRIEFING  - Events, traffic, news gathering
 *   🏢 VENUES    - Venue discovery, enrichment, validation
 *   🍺 BARS      - Bar-specific operations (subset of venues)
 *   🌤️ WEATHER   - Weather API calls
 *   🔑 AUTH      - Authentication/authorization
 */
const WORKFLOWS = {
  // Location resolution for header/user context
  LOCATION: { phases: 3, emoji: '📍' },

  // User/device tracking
  USER: { phases: 2, emoji: '👤' },

  // Snapshot creation
  SNAPSHOT: { phases: 2, emoji: '📸' },

  // Main strategy pipeline (TRIAD)
  TRIAD: { phases: 4, emoji: '🎯' },

  // SmartBlocks venue pipeline
  VENUES: { phases: 4, emoji: '🏢' },

  // Bar-specific operations
  BARS: { phases: 2, emoji: '🍺' },

  // Briefing service
  BRIEFING: { phases: 3, emoji: '📰' },

  // Events ETL pipeline (briefing-service.js → Gemini discovery)
  // Phase 1: EXTRACT - Provider calls (Gemini + Google Search)
  // Phase 2: TRANSFORM_A - Normalization + Validation
  // Phase 3: TRANSFORM_B - Geocode + Venue Linking
  // Phase 4: LOAD - Upsert to discovered_events
  // Phase 5: ASSEMBLE - Query + Join + Shape for briefings
  EVENTS: { phases: 5, emoji: '📅' },

  // Weather fetching
  WEATHER: { phases: 1, emoji: '🌤️' },

  // AI model calls (generic - prefer using section + OP.AI)
  AI: { phases: 1, emoji: '🤖' },

  // Database operations (generic - prefer using section + OP.DB)
  DB: { phases: 1, emoji: '💾' },

  // Auth operations
  AUTH: { phases: 1, emoji: '🔑' },

  // Server-sent events (generic - prefer using section + OP.SSE)
  SSE: { phases: 1, emoji: '📡' },

  // Pipeline phase updates
  PHASE: { phases: 1, emoji: '🔄' },

  // Google Places API
  PLACES: { phases: 1, emoji: '📍' },

  // Google Routes API
  ROUTES: { phases: 1, emoji: '🚗' },
};

/**
 * Phase descriptions for clearer logs
 * NOTE: Use ROLE names not model names (Strategist not Claude, Briefer not Gemini)
 *
 * STRATEGY TERMS:
 *   - "Daily Strategy" = consolidated_strategy (8-12hr overview)
 *   - "NOW Strategy" = strategy_for_now (1hr tactical)
 */
const PHASE_LABELS = {
  // LOCATION phases
  'LOCATION:1': 'GPS Received',
  'LOCATION:2': 'Geocode/Cache',
  'LOCATION:3': 'Weather+Air',

  // USER phases
  'USER:1': 'Lookup/Create',
  'USER:2': 'Token Issue',

  // SNAPSHOT phases
  'SNAPSHOT:1': 'Create Record',
  'SNAPSHOT:2': 'Enrich (Airport/Holiday)',

  // TRIAD phases (use ROLE names, not model names)
  // Strategy TRIAD = phases 1-3, Venue TRIAD = phase 4
  'TRIAD:1': 'Strategy|Strategist',
  'TRIAD:2': 'Strategy|Briefer',
  'TRIAD:3': 'Strategy|NOW',
  'TRIAD:4': 'Venue|SmartBlocks',

  // VENUES phases
  'VENUES:1': 'Tactical Planner',
  'VENUES:2': 'Routes API',
  'VENUES:3': 'Places API',
  'VENUES:4': 'DB Store',

  // BARS phases
  'BARS:1': 'Query',
  'BARS:2': 'Enrich',

  // BRIEFING phases (Briefing TRIAD)
  'BRIEFING:1': 'Briefing|Traffic',
  'BRIEFING:2': 'Briefing|Events',
  'BRIEFING:3': 'Briefing|Validation',

  // EVENTS ETL phases (briefing-service.js → Gemini pipeline)
  // Canonical ETL pipeline: Extract → Transform → Load → Assemble
  'EVENTS:1': 'Extract|Providers',       // Gemini + Google Search discovery
  'EVENTS:2': 'Transform|Normalize',     // normalizeEvent + validateEvent
  'EVENTS:3': 'Transform|Geocode',       // Geocode + venue linking (optional)
  'EVENTS:4': 'Load|Store',              // Upsert to discovered_events with event_hash
  'EVENTS:5': 'Assemble|Briefing',       // Query from DB + shape for briefings
};

/**
 * Create a workflow logger for a specific component
 * @param {string} component - Component name (LOCATION, SNAPSHOT, TRIAD, VENUES, BRIEFING)
 * @returns {Object} Logger with phase-aware methods
 */
export function createWorkflowLogger(component) {
  const config = WORKFLOWS[component] || { phases: 1, emoji: '📋' };

  return {
    /**
     * Log a phase start/progress with optional operation type
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Log message
     * @param {Object|string} dataOrOp - Optional data object or operation type icon (OP.AI, OP.API, etc.)
     */
    phase: (phase, message, dataOrOp = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;

      // Check if dataOrOp is an operation icon (string starting with emoji)
      const isOpIcon = typeof dataOrOp === 'string' && Object.values(OP).includes(dataOrOp);
      const opSuffix = isOpIcon ? `  ← ${dataOrOp}` : '';
      const data = isOpIcon ? null : dataOrOp;

      if (data) {
        console.log(`${config.emoji} ${prefix} ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 0).slice(0, 200) : data);
      } else {
        console.log(`${config.emoji} ${prefix} ${message}${opSuffix}`);
      }
    },

    /**
     * Log phase completion with timing and optional operation type
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Success message
     * @param {number|string} durationOrOp - Duration in ms OR operation type icon
     * @param {string} op - Optional operation type icon if duration is provided
     */
    done: (phase, message, durationOrOp = null, op = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;

      // Handle flexible arguments
      let durationMs = null;
      let opIcon = null;
      if (typeof durationOrOp === 'number') {
        durationMs = durationOrOp;
        opIcon = op;
      } else if (typeof durationOrOp === 'string' && Object.values(OP).includes(durationOrOp)) {
        opIcon = durationOrOp;
      }

      const timeStr = durationMs ? ` (${durationMs}ms)` : '';
      const opSuffix = opIcon ? `  ← ${opIcon}` : '';

      console.log(`${config.emoji} ${prefix} ✅ ${message}${timeStr}${opSuffix}`);
    },

    /**
     * Log an error in a phase with optional operation type
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Error message
     * @param {Error|string} err - Error object or message
     * @param {string} op - Optional operation type icon
     */
    error: (phase, message, err = null, op = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;
      const errMsg = err?.message || err || '';
      const opSuffix = op ? `  ← ${op}` : '';

      console.error(`${config.emoji} ${prefix} ❌ ${message}${errMsg ? `: ${errMsg}` : ''}${opSuffix}`);
    },

    /**
     * Log a warning in a phase with optional operation type
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Warning message
     * @param {string} op - Optional operation type icon
     */
    warn: (phase, message, op = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;
      const opSuffix = op ? `  ← ${op}` : '';

      console.warn(`${config.emoji} ${prefix} ⚠️ ${message}${opSuffix}`);
    },

    /**
     * Log workflow start
     * @param {string} context - Context info (e.g., snapshot_id, city)
     */
    start: (context) => {
      console.log(`\n${config.emoji} ═══════════════════════════════════════════════════════`);
      console.log(`${config.emoji} [${component}] START: ${context}`);
      console.log(`${config.emoji} ═══════════════════════════════════════════════════════`);
    },

    /**
     * Log workflow complete
     * @param {string} summary - Summary message
     * @param {number} totalMs - Total duration
     */
    complete: (summary, totalMs = null) => {
      const timeStr = totalMs ? ` (${totalMs}ms)` : '';
      console.log(`${config.emoji} ───────────────────────────────────────────────────────`);
      console.log(`${config.emoji} [${component}] ✅ COMPLETE: ${summary}${timeStr}`);
      console.log(`${config.emoji} ───────────────────────────────────────────────────────\n`);
    },

    /**
     * Simple info log (no phase) with optional operation type
     * @param {string} message - Log message
     * @param {Object|string} dataOrOp - Optional data or operation type icon
     */
    info: (message, dataOrOp = null) => {
      const isOpIcon = typeof dataOrOp === 'string' && Object.values(OP).includes(dataOrOp);
      const opSuffix = isOpIcon ? `  ← ${dataOrOp}` : '';
      const data = isOpIcon ? null : dataOrOp;

      if (data) {
        console.log(`${config.emoji} [${component}] ${message}`, data);
      } else {
        console.log(`${config.emoji} [${component}] ${message}${opSuffix}`);
      }
    },

    /**
     * Log an API call (convenience method)
     * @param {number} phase - Current phase
     * @param {string} apiName - API being called (e.g., "Google Routes", "Places API")
     * @param {string} context - Additional context
     */
    api: (phase, apiName, context = '') => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;
      const contextStr = context ? `: ${context}` : '';
      console.log(`${config.emoji} ${prefix} ${apiName}${contextStr}  ← ${OP.API}`);
    },

    /**
     * Log an AI model call (convenience method)
     * @param {number} phase - Current phase
     * @param {string} role - Model role (e.g., "Strategist", "Briefer")
     * @param {string} context - Additional context
     */
    ai: (phase, role, context = '') => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;
      const contextStr = context ? `: ${context}` : '';
      console.log(`${config.emoji} ${prefix} Calling ${role}${contextStr}  ← ${OP.AI}`);
    },

    /**
     * Log a database operation (convenience method)
     * @param {number} phase - Current phase
     * @param {string} operation - DB operation (e.g., "Saving", "Querying")
     * @param {string} context - Additional context
     */
    db: (phase, operation, context = '') => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;
      const contextStr = context ? `: ${context}` : '';
      console.log(`${config.emoji} ${prefix} ${operation}${contextStr}  ← ${OP.DB}`);
    },
  };
}

// Pre-configured loggers for common workflows
export const locationLog = createWorkflowLogger('LOCATION');
export const userLog = createWorkflowLogger('USER');
export const snapshotLog = createWorkflowLogger('SNAPSHOT');
export const triadLog = createWorkflowLogger('TRIAD');
export const venuesLog = createWorkflowLogger('VENUES');
export const barsLog = createWorkflowLogger('BARS');
export const briefingLog = createWorkflowLogger('BRIEFING');
export const eventsLog = createWorkflowLogger('EVENTS');  // ETL pipeline for event discovery
export const weatherLog = createWorkflowLogger('WEATHER');
export const aiLog = createWorkflowLogger('AI');
export const dbLog = createWorkflowLogger('DB');
export const authLog = createWorkflowLogger('AUTH');
export const sseLog = createWorkflowLogger('SSE');
export const phaseLog = createWorkflowLogger('PHASE');
export const placesLog = createWorkflowLogger('PLACES');
export const routesLog = createWorkflowLogger('ROUTES');

/**
 * Log AI model call with standardized format
 * @param {string} role - Model role (strategist, briefer, consolidator, etc.)
 * @param {string} model - Model ID
 * @param {string} purpose - What this call is for
 */
export function logAICall(role, model, purpose) {
  console.log(`🤖 [AI] Calling ${role} (${model}): ${purpose}  ← ${OP.AI}`);
}

/**
 * Log AI model response
 * @param {string} role - Model role
 * @param {string} model - Model ID
 * @param {number} responseLen - Response length in chars
 * @param {number} durationMs - Call duration
 */
export function logAIResponse(role, model, responseLen, durationMs) {
  console.log(`🤖 [AI] ✅ ${role} responded: ${responseLen} chars (${durationMs}ms)  ← ${OP.AI}`);
}

/**
 * Log venue-specific operations
 * @param {string} venueName - Venue name
 * @param {string} operation - What operation (distance, hours, etc.)
 * @param {string} result - Result summary
 * @param {string} op - Optional operation type icon
 */
export function logVenue(venueName, operation, result, op = null) {
  const shortName = venueName.length > 30 ? venueName.slice(0, 27) + '...' : venueName;
  const opSuffix = op ? `  ← ${op}` : '';
  console.log(`🏢 [VENUE "${shortName}"] ${operation}: ${result}${opSuffix}`);
}

/**
 * Log an external API call (Google, etc.)
 * @param {string} apiName - API name (e.g., "Google Routes", "Places API")
 * @param {string} context - What this call is for
 */
export function logAPICall(apiName, context) {
  console.log(`🌐 [API] ${apiName}: ${context}  ← ${OP.API}`);
}

/**
 * Log an external API response
 * @param {string} apiName - API name
 * @param {string} result - Result summary
 * @param {number} durationMs - Call duration
 */
export function logAPIResponse(apiName, result, durationMs = null) {
  const timeStr = durationMs ? ` (${durationMs}ms)` : '';
  console.log(`🌐 [API] ✅ ${apiName}: ${result}${timeStr}  ← ${OP.API}`);
}

/**
 * Log a database operation
 * @param {string} operation - Operation type (SELECT, INSERT, UPDATE, etc.)
 * @param {string} table - Table name
 * @param {string} context - Additional context
 */
export function logDB(operation, table, context = '') {
  const contextStr = context ? `: ${context}` : '';
  console.log(`💾 [DB] ${operation} ${table}${contextStr}  ← ${OP.DB}`);
}

/**
 * Log a cache operation
 * @param {string} type - "HIT" or "MISS"
 * @param {string} key - Cache key or description
 */
export function logCache(type, key) {
  const icon = type === 'HIT' ? '⚡' : '🔍';
  console.log(`${icon} [CACHE] ${type}: ${key}  ← ${OP.CACHE}`);
}
