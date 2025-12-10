/**
 * Workflow-Aware Logging Utility
 *
 * Provides structured logging that clearly shows the pipeline workflow.
 * Each log line includes: [COMPONENT] [PHASE n/m] message
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
 *    [TRIAD 1/4 - MinStrategy] Claude Opus strategic analysis
 *    [TRIAD 2/4 - Briefing] Gemini events/traffic/news
 *    [TRIAD 3/4 - Consolidator] GPT-5.1 tactical synthesis
 *    [TRIAD 4/4 - SmartBlocks] Venue planning + enrichment
 *
 * 4. SMARTBLOCKS (Venue Pipeline)
 *    [VENUES 1/4] GPT-5 tactical planner
 *    [VENUES 2/4] Google Routes API (distances)
 *    [VENUES 3/4] Google Places API (hours/status)
 *    [VENUES 4/4] Event verification
 *
 * 5. BRIEFING (Events/News)
 *    [BRIEFING 1/3] Traffic analysis
 *    [BRIEFING 2/3] Events discovery (Gemini)
 *    [BRIEFING 3/3] Event validation (Claude)
 */

/**
 * Workflow components with their phases
 */
const WORKFLOWS = {
  // Location resolution for header/user context
  LOCATION: { phases: 3, emoji: '📍' },

  // Snapshot creation
  SNAPSHOT: { phases: 2, emoji: '📸' },

  // Main strategy pipeline (TRIAD)
  TRIAD: { phases: 4, emoji: '🎯' },

  // SmartBlocks venue pipeline
  VENUES: { phases: 4, emoji: '🏢' },

  // Briefing service
  BRIEFING: { phases: 3, emoji: '📰' },

  // Weather fetching
  WEATHER: { phases: 1, emoji: '🌤️' },

  // AI model calls
  AI: { phases: 1, emoji: '🤖' },

  // Database operations
  DB: { phases: 1, emoji: '💾' },

  // Auth operations
  AUTH: { phases: 1, emoji: '🔑' },
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

  // SNAPSHOT phases
  'SNAPSHOT:1': 'Create Record',
  'SNAPSHOT:2': 'Enrich (Airport/Holiday)',

  // TRIAD phases (use ROLE names, not model names)
  'TRIAD:1': 'Strategist',
  'TRIAD:2': 'Briefer',
  'TRIAD:3': 'Daily+NOW Strategy',
  'TRIAD:4': 'SmartBlocks',

  // VENUES phases
  'VENUES:1': 'Tactical Planner',
  'VENUES:2': 'Routes API',
  'VENUES:3': 'Places API',
  'VENUES:4': 'DB Store',

  // BRIEFING phases
  'BRIEFING:1': 'Traffic',
  'BRIEFING:2': 'Events Discovery',
  'BRIEFING:3': 'Event Validation',
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
     * Log a phase start/progress
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Log message
     * @param {Object} data - Optional data to log
     */
    phase: (phase, message, data = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;

      if (data) {
        console.log(`${config.emoji} ${prefix} ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 0).slice(0, 200) : data);
      } else {
        console.log(`${config.emoji} ${prefix} ${message}`);
      }
    },

    /**
     * Log phase completion with timing
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Success message
     * @param {number} durationMs - Optional duration in ms
     */
    done: (phase, message, durationMs = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const timeStr = durationMs ? ` (${durationMs}ms)` : '';
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;

      console.log(`✅ ${prefix} ${message}${timeStr}`);
    },

    /**
     * Log an error in a phase
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Error message
     * @param {Error|string} err - Error object or message
     */
    error: (phase, message, err = null) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;
      const errMsg = err?.message || err || '';

      console.error(`❌ ${prefix} ${message}${errMsg ? `: ${errMsg}` : ''}`);
    },

    /**
     * Log a warning in a phase
     * @param {number} phase - Current phase (1-indexed)
     * @param {string} message - Warning message
     */
    warn: (phase, message) => {
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${component} ${phaseStr}${label ? ` - ${label}` : ''}]`;

      console.warn(`⚠️ ${prefix} ${message}`);
    },

    /**
     * Log workflow start
     * @param {string} context - Context info (e.g., snapshot_id, city)
     */
    start: (context) => {
      console.log(`${config.emoji} [${component} START] ========== ${context} ==========`);
    },

    /**
     * Log workflow complete
     * @param {string} summary - Summary message
     * @param {number} totalMs - Total duration
     */
    complete: (summary, totalMs = null) => {
      const timeStr = totalMs ? ` in ${totalMs}ms` : '';
      console.log(`🏁 [${component} COMPLETE] ${summary}${timeStr}`);
    },

    /**
     * Simple info log (no phase)
     * @param {string} message - Log message
     * @param {Object} data - Optional data
     */
    info: (message, data = null) => {
      if (data) {
        console.log(`${config.emoji} [${component}] ${message}`, data);
      } else {
        console.log(`${config.emoji} [${component}] ${message}`);
      }
    },
  };
}

// Pre-configured loggers for common workflows
export const locationLog = createWorkflowLogger('LOCATION');
export const snapshotLog = createWorkflowLogger('SNAPSHOT');
export const triadLog = createWorkflowLogger('TRIAD');
export const venuesLog = createWorkflowLogger('VENUES');
export const briefingLog = createWorkflowLogger('BRIEFING');
export const weatherLog = createWorkflowLogger('WEATHER');
export const aiLog = createWorkflowLogger('AI');
export const dbLog = createWorkflowLogger('DB');

/**
 * Log AI model call with standardized format
 * @param {string} role - Model role (strategist, briefer, consolidator, etc.)
 * @param {string} model - Model ID
 * @param {string} purpose - What this call is for
 */
export function logAICall(role, model, purpose) {
  console.log(`🤖 [AI - ${role}] Calling ${model} for: ${purpose}`);
}

/**
 * Log AI model response
 * @param {string} role - Model role
 * @param {string} model - Model ID
 * @param {number} responseLen - Response length in chars
 * @param {number} durationMs - Call duration
 */
export function logAIResponse(role, model, responseLen, durationMs) {
  console.log(`✅ [AI - ${role}] ${model} responded: ${responseLen} chars in ${durationMs}ms`);
}

/**
 * Log venue-specific operations
 * @param {string} venueName - Venue name
 * @param {string} operation - What operation (distance, hours, etc.)
 * @param {string} result - Result summary
 */
export function logVenue(venueName, operation, result) {
  const shortName = venueName.length > 30 ? venueName.slice(0, 27) + '...' : venueName;
  console.log(`🏢 [VENUE "${shortName}"] ${operation}: ${result}`);
}
