/**
 * Workflow-Aware Logging Utility
 *
 * VISUAL LOG DESIGN:
 * Each log line shows [SECTION ICON] message [OPERATION ICON]
 * - LEFT icon = Which workflow section (TRIAD, VENUES, BRIEFING)
 * - RIGHT icon = What operation type (AI call, API call, DB, etc.)
 *
 * Example output:
 *   [TRIAD 1/4] Calling strategist                    ← 🤖
 *   [TRIAD 1/4] Strategist complete (2341ms)       ← 🤖
 *   [VENUES 2/4] Calculating routes                   ← 🌐
 *   [VENUES 3/4] Fetching place details               ← 🌐
 *   [BRIEFING 1/3] Fetching traffic                   ← 🌐
 *   [DB] Saved strategy                               ← 💾
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
 *
 * --------------------------------------------------------------------------
 * 2026-04-27 (Commit 1 of CLEAR_CONSOLE_WORKFLOW spec):
 * Control plane added — env-driven level filter, component quiet/verbose lists,
 * structured JSON output to stderr, withContext() correlation binding, and a
 * first-class debug() method on every logger. The existing positional API
 * (phase/done/error/warn/start/complete/info/api/ai/db) is unchanged — every
 * method now gates through shouldEmit() so the env vars take effect without
 * touching any of the 10 existing consumer files.
 *
 * Env vars:
 *   LOG_LEVEL=debug|info|warn|error          (default: info)
 *   LOG_FORMAT=pretty|json|both              (default: pretty; JSON → stderr)
 *   LOG_QUIET_COMPONENTS=BARS,VENUES,SSE     (silences info/debug)
 *   LOG_VERBOSE_COMPONENTS=BARS,VENUES       (forces debug+ for components)
 *
 * warn and error are NEVER silenced. Component names are case-insensitive.
 */

// ==========================================================
// CONTROL PLANE — env-driven filters and structured emission
// ==========================================================
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const LOG_LEVEL_RAW = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_LEVEL = LEVELS[LOG_LEVEL_RAW] !== undefined ? LOG_LEVEL_RAW : 'info';

const LOG_FORMAT_RAW = String(process.env.LOG_FORMAT || 'pretty').toLowerCase();
const LOG_FORMAT = ['pretty', 'json', 'both'].includes(LOG_FORMAT_RAW) ? LOG_FORMAT_RAW : 'pretty';

// 2026-04-27: Strip section emojis from pretty output. Default TRUE per
// CLEAR_CONSOLE_WORKFLOW format spec ("[Briefing] calling news from Briefer").
// Set LOG_NO_EMOJI=false to restore the legacy emoji visual design.
const LOG_NO_EMOJI = String(process.env.LOG_NO_EMOJI ?? 'true').toLowerCase() !== 'false';
function _emojiPrefix(emoji) {
  return LOG_NO_EMOJI ? '' : `${emoji} `;
}

// 2026-04-27 (Commit 5): When LOG_NO_EMOJI is set, also strip the trailing
// "  ← {opIcon}" suffix and the inline ✓/✗/⚠ status indicators from done(),
// error(), and warn(). These are decorative emojis with the same readability
// concern as the section icon — partial stripping leaves visible emojis.
function _opSuffix(opIcon) {
  if (!opIcon) return '';
  return LOG_NO_EMOJI ? '' : `  ← ${opIcon}`;
}
const DECO_DONE = LOG_NO_EMOJI ? '' : '';
const DECO_ERR  = LOG_NO_EMOJI ? '' : '';
const DECO_WARN = LOG_NO_EMOJI ? '' : '';

// 2026-04-27: Title-Case display labels per CLEAR_CONSOLE_WORKFLOW format spec:
// "[Briefing] calling news from Briefer" — category in title case, role/service
// names not model names. Falls through to component name unchanged for unmapped.
//
// 2026-04-27 refinement (Commit 5): TRIAD aliased to Strategy (no [Triad] in
// logs — strategy umbrella replaces it). VENUE_PLANNING aliased to Venues so
// waterfall phase reads as the same name as venue sub-steps.
// 2026-04-27 (Commit 6 refinement): UPPERCASE per Melody's most-recent example
// log. Matches the canonical format in
// .rules-and-requirements/2026-04-27-format-target-example.md.
const COMPONENT_LABELS = {
  LOCATION: 'LOCATION',
  USER: 'USER',
  SNAPSHOT: 'SNAPSHOT',
  TRIAD: 'STRATEGY',           // collapsed: TRIAD is a strategy concept, not its own bucket
  VENUES: 'VENUE',             // singular per spec ("[VENUE] Called Venue Planner")
  VENUE: 'VENUE',
  BARS: 'BARS',
  BRIEFING: 'BRIEFING',
  EVENTS: 'EVENTS',
  WEATHER: 'WEATHER',
  AI: 'AI',
  DB: 'DB',
  AUTH: 'AUTH',
  SSE: 'SSE',
  PHASE: 'PHASE',
  PLACES: 'PLACES',
  ROUTES: 'ROUTES',
  WATERFALL: 'WATERFALL',
  STRATEGY: 'STRATEGY',
  MODEL_REGISTRY: 'MODELS',
  CACHE: 'CACHE',
  API: 'API',
  GATEWAY: 'GATEWAY',
  BOOT: 'BOOT',
  CONFIG: 'CONFIG',
  AGENT: 'AGENT',
  COACH: 'COACH',
  'RIDESHARE COACH': 'RIDESHARE COACH',
  TRANSLATION: 'TRANSLATION',
  HEALTH: 'HEALTH',
  TTS: 'TTS',
  ROUTES: 'ROUTES',
  FEEDBACK: 'FEEDBACK',
  VEHICLE: 'VEHICLE',
  HOOKS: 'HOOKS',
  MEMORY: 'MEMORY',
  NOTIFY: 'NOTIFY',
  CONCIERGE: 'CONCIERGE',
};
function _componentLabel(component) {
  const upper = String(component || '').toUpperCase();
  return COMPONENT_LABELS[upper] || upper;
}

// 2026-04-27 (Commit 6): Hierarchical bracket emit. Lets callers compose
// "[BRIEFING] [EVENTS] [DEDUP] [EXECUTED] message" — chain of category tags
// where the leftmost is a main category and subsequent tags narrow context.
// Foundational rule (claude_memory row 205): every log line MUST start with a
// main category. The first element of `tags` is the main category; rest are
// sub-categories.
//
// Usage:
//   tagLog(['BRIEFING', 'EVENTS', 'DEDUP', 'EXECUTED'], '3 variants of "..."');
//   tagLog(['BRIEFING', 'WEATHER', 'DB', 'LISTEN/NOTIFY'], 'briefing_weather_ready (first subscriber)');
//   tagLog(['STRATEGY'], 'Calling Strategist');
//
// Optional: { level, request_id, snapshot_id } as third arg.
const _MAIN_CATEGORIES = new Set([
  'BOOT', 'CONFIG', 'GATEWAY', 'AGENT',
  'AUTH',
  'SNAPSHOT', 'BRIEFING', 'STRATEGY', 'VENUE', 'WATERFALL',
  'EVENTS', 'BARS',
  // 'AI' is tolerated for adapter-level infrastructure logs that don't
  // know their caller's main category. Prefer threading the main category
  // through (e.g., [STRATEGY] [AI] not [AI]) when the call site knows it.
  'AI', 'MODELS',
  // User-facing feature mains
  // 2026-04-28 (memory 225): RIDESHARE COACH is the canonical label for the
  // rideshare-driver coach. Plain COACH is retained for back-compat during the
  // Phase B sweep but should be migrated.
  'RIDESHARE COACH', 'COACH', 'TRANSLATION', 'HEALTH', 'TTS',
  // Other features
  'FEEDBACK', 'VEHICLE', 'HOOKS', 'MEMORY', 'NOTIFY', 'CONCIERGE',
  // Generic infra fallback
  'API',
]);

export function tagLog(tags, message, opts = {}) {
  if (!Array.isArray(tags) || tags.length === 0) {
    tags = ['GATEWAY']; // fail-safe: orphan logs become [GATEWAY]
  }
  const upper = tags.map((t) => String(t).toUpperCase());
  const main = upper[0];
  const level = opts.level || 'info';

  // Enforce the foundational rule — leftmost MUST be a main category
  if (!_MAIN_CATEGORIES.has(main)) {
    // Don't throw; emit a warning so the caller can fix it without breaking prod
    process.stderr.write(
      `[LOGGER WARN] tagLog called with non-main leftmost category "${main}". ` +
      `Valid mains: ${[..._MAIN_CATEGORIES].join(', ')}\n`
    );
  }

  if (!shouldEmit(level, main)) return;

  const ctxStr = formatContextStr(opts);
  const bracketChain = upper.map((t) => `[${t}]`).join(' ');
  const ctxSuffix = ctxStr ? ` ${ctxStr}` : '';

  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    const sink = level === 'error' ? console.error
               : level === 'warn'  ? console.warn
               : level === 'debug' ? console.debug
               : console.log;
    sink(`${bracketChain}${ctxSuffix} ${message}`);
  }
  emitJSON(level, main, message, {
    tags: upper,
    request_id: opts.request_id,
    snapshot_id: opts.snapshot_id,
    route: opts.route,
  });
}

/**
 * 2026-04-28 (memory 229 + 230): canonical chain helper.
 *
 * Builds a positional bracket chain per doctrine:
 *   [Parent] [Sub] [CallType...] [CallName] message
 *
 * Slots (parent required, rest optional):
 *   parent     - Top-level stage (e.g. 'BRIEFING', 'VENUE'). UPPERCASED.
 *   sub        - Narrower function (e.g. 'TRAFFIC', 'NEWS', 'TTS'). UPPERCASED.
 *   callTypes  - Op footprint, stackable: ['AI'], ['API','AI'], ['DB']. UPPERCASED.
 *   callName   - Target identity. CASE PRESERVED. Roles TitleCase ('Briefer',
 *                'Planner', 'Strategist'); tables snake_case ('venue_cards');
 *                services TitleCase ('TomTom', 'GooglePlaces').
 *   table      - alias for callName when DB is in callTypes (clarity at call sites).
 *
 * Validators:
 *   - DB in callTypes requires table/callName (memory 230). Missing -> warn.
 *   - parent must be a registered main category. Missing -> warn.
 *
 * Description rule (doctrine, not enforced):
 *   - Start with WHY (why this is happening) — chain encodes WHAT.
 *   - No city/state in description; chain + snapshot_id locate the line (memory 230).
 *
 * Usage:
 *   chainLog({ parent: 'BRIEFING', sub: 'NEWS', callTypes: ['AI'], callName: 'Briefer' },
 *            'Fetching news for Dallas-Fort Worth');
 *   // -> [BRIEFING] [NEWS] [AI] [Briefer] Fetching news for Dallas-Fort Worth
 *
 *   chainLog({ parent: 'VENUE', callTypes: ['DB'], table: 'venue_cards' },
 *            'Stored 6 records');
 *   // -> [VENUE] [DB] [venue_cards] Stored 6 records
 *
 *   chainLog({ parent: 'BRIEFING', sub: 'TRAFFIC', callTypes: ['API','AI'],
 *              callName: 'Briefer' },
 *            'Calling TomTom for traffic and sent to Briefer for consolidation');
 *   // -> [BRIEFING] [TRAFFIC] [API] [AI] [Briefer] Calling TomTom for traffic ...
 */
export function chainLog(spec, message, opts = {}) {
  const { parent, sub, callTypes, callName, table } = spec || {};
  const level = opts.level || spec?.level || 'info';
  const types = Array.isArray(callTypes) ? callTypes : (callTypes ? [callTypes] : []);
  const name = table || callName;

  const includesDB = types.some((t) => String(t).toUpperCase() === 'DB');
  if (includesDB && !name) {
    process.stderr.write(
      `[LOGGER WARN] chainLog: callTypes contains 'DB' but no table/callName provided. ` +
      `Per memory 230, DB CallType MUST carry the table or channel name. ` +
      `parent=${parent} sub=${sub ?? '-'} callTypes=${JSON.stringify(types)}\n`
    );
  }

  const upperParent = String(parent || '').toUpperCase();
  if (!parent) {
    process.stderr.write(`[LOGGER WARN] chainLog: parent is required\n`);
  } else if (!_MAIN_CATEGORIES.has(upperParent)) {
    process.stderr.write(
      `[LOGGER WARN] chainLog: parent "${parent}" is not a registered main category.\n`
    );
  }

  if (!shouldEmit(level, upperParent)) return;

  // Parent/sub/callTypes UPPERCASE per doctrine; callName preserves case.
  const parts = [];
  if (parent) parts.push(`[${upperParent}]`);
  if (sub) parts.push(`[${String(sub).toUpperCase()}]`);
  for (const t of types) parts.push(`[${String(t).toUpperCase()}]`);
  if (name) parts.push(`[${name}]`);

  const ctxStr = formatContextStr({
    request_id: opts.request_id || spec?.request_id,
    snapshot_id: opts.snapshot_id || spec?.snapshot_id,
    route: opts.route || spec?.route,
  });
  const bracketChain = parts.join(' ');
  const ctxSuffix = ctxStr ? ` ${ctxStr}` : '';

  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    const sink = level === 'error' ? console.error
               : level === 'warn'  ? console.warn
               : level === 'debug' ? console.debug
               : console.log;
    sink(`${bracketChain}${ctxSuffix} ${message}`);
  }
  emitJSON(level, upperParent, message, {
    chain: {
      parent: upperParent,
      sub: sub ? String(sub).toUpperCase() : null,
      callTypes: types.map((t) => String(t).toUpperCase()),
      callName: name || null,
    },
    request_id: opts.request_id || spec?.request_id,
    snapshot_id: opts.snapshot_id || spec?.snapshot_id,
    route: opts.route || spec?.route,
  });
}

const QUIET_COMPONENTS = new Set(
  String(process.env.LOG_QUIET_COMPONENTS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

const VERBOSE_COMPONENTS = new Set(
  String(process.env.LOG_VERBOSE_COMPONENTS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

/**
 * Decide whether a log line should be emitted.
 * - warn/error always emit (never silently swallow failures)
 * - LOG_VERBOSE_COMPONENTS forces emit at any level
 * - LOG_QUIET_COMPONENTS silences info/debug
 * - Otherwise: standard level comparison vs. LOG_LEVEL
 */
function shouldEmit(level, component) {
  const normalized = String(component || '').toUpperCase();
  if (level === 'error' || level === 'warn') return true;
  if (VERBOSE_COMPONENTS.has(normalized)) return true;
  if (QUIET_COMPONENTS.has(normalized)) return false;
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

/**
 * Emit a structured event to stderr if LOG_FORMAT is 'json' or 'both'.
 * stderr keeps stdout clean for jq/log-shipper pipelines that consume pretty.
 */
function emitJSON(level, component, message, extra = {}) {
  if (LOG_FORMAT !== 'json' && LOG_FORMAT !== 'both') return;
  const evt = {
    ts: new Date().toISOString(),
    level,
    component: String(component || '').toUpperCase(),
    message: String(message ?? ''),
    ...extra,
  };
  try {
    process.stderr.write(JSON.stringify(evt) + '\n');
  } catch {
    // best-effort: never throw from logger
  }
}

// ==========================================================
// EXISTING TAXONOMY (preserved verbatim)
// ==========================================================

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
 *   USER      - User table, auth, device tracking
 *   SNAPSHOT  - Snapshot creation and enrichment
 *   TRIAD     - Main strategy pipeline orchestration
 *   BRIEFING  - Events, traffic, news gathering
 *   VENUES    - Venue discovery, enrichment, validation
 *   BARS      - Bar-specific operations (subset of venues)
 *   🌤️ WEATHER   - Weather API calls
 *   AUTH      - Authentication/authorization
 */
const WORKFLOWS = {
  LOCATION: { phases: 3, emoji: '📍' },
  USER: { phases: 2, emoji: '👤' },
  SNAPSHOT: { phases: 2, emoji: '📸' },
  // 2026-04-28 (memory 233): TRIAD retired. STRATEGY is canonical.
  // TRIAD entry retained for back-compat with any direct WORKFLOWS lookups.
  TRIAD: { phases: 4, emoji: '🎯' },
  STRATEGY: { phases: 4, emoji: '🎯' },
  VENUES: { phases: 4, emoji: '🏢' },
  BARS: { phases: 2, emoji: '🍺' },
  BRIEFING: { phases: 3, emoji: '📰' },
  EVENTS: { phases: 5, emoji: '📅' },
  WEATHER: { phases: 1, emoji: '🌤️' },
  AI: { phases: 1, emoji: '🤖' },
  DB: { phases: 1, emoji: '💾' },
  AUTH: { phases: 1, emoji: '🔑' },
  SSE: { phases: 1, emoji: '📡' },
  PHASE: { phases: 1, emoji: '🔄' },
  PLACES: { phases: 1, emoji: '📍' },
  ROUTES: { phases: 1, emoji: '🚗' },
  // 2026-04-27: Waterfall taxonomy components for top-level 5-stage pipeline.
  // Commit 5: VENUE_PLANNING renamed to VENUE per "one word in [Example]" spec.
  STRATEGY: { phases: 1, emoji: '🎯' },
  VENUE:    { phases: 1, emoji: '🏢' },
  WATERFALL: { phases: 5, emoji: '🌊' },
  // Generic fallback for misc emitters
  GENERIC: { phases: 1, emoji: '📋' },
};

/**
 * Phase descriptions for clearer logs
 * NOTE: Use ROLE names not model names (Strategist not Claude, Briefer not Gemini)
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

  // STRATEGY phases. Both 'STRATEGY:N' (canonical, memory 233) and
  // 'TRIAD:N' (legacy back-compat) keys retained — values match canonical
  // role names per memory 224/229. VenueComponentCard replaced SmartBlocks
  // 2026-04-28 per Melody.
  'STRATEGY:1': 'Strategy|Strategist',
  'STRATEGY:2': 'Strategy|Briefer',
  'STRATEGY:3': 'Strategy|NOW',
  'STRATEGY:4': 'Venue|VenueComponentCard',
  'TRIAD:1': 'Strategy|Strategist',
  'TRIAD:2': 'Strategy|Briefer',
  'TRIAD:3': 'Strategy|NOW',
  'TRIAD:4': 'Venue|VenueComponentCard',

  // VENUES phases
  'VENUES:1': 'Planner',
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
  'EVENTS:1': 'Extract|Providers',
  'EVENTS:2': 'Transform|Normalize',
  'EVENTS:3': 'Transform|Geocode',
  'EVENTS:4': 'Load|Store',
  'EVENTS:5': 'Assemble|Briefing',
};

// ==========================================================
// LOGGER FACTORY
// Each method early-returns via shouldEmit() so env vars take effect.
// Pretty output preserved; JSON output additive when LOG_FORMAT enables it.
// ==========================================================

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
     */
    phase: (phase, message, dataOrOp = null) => {
      if (!shouldEmit('info', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;

      const isOpIcon = typeof dataOrOp === 'string' && Object.values(OP).includes(dataOrOp);
      const opSuffix = isOpIcon ? _opSuffix(dataOrOp) : '';
      const data = isOpIcon ? null : dataOrOp;

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        if (data) {
          console.log(`${_emojiPrefix(config.emoji)}${prefix} ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 0).slice(0, 200) : data);
        } else {
          console.log(`${_emojiPrefix(config.emoji)}${prefix} ${message}${opSuffix}`);
        }
      }
      emitJSON('info', component, message, { phase: phaseStr, phase_label: label });
    },

    /**
     * Log phase completion with timing and optional operation type
     */
    done: (phase, message, durationOrOp = null, op = null) => {
      if (!shouldEmit('info', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;

      let durationMs = null;
      let opIcon = null;
      if (typeof durationOrOp === 'number') {
        durationMs = durationOrOp;
        opIcon = op;
      } else if (typeof durationOrOp === 'string' && Object.values(OP).includes(durationOrOp)) {
        opIcon = durationOrOp;
      }

      const timeStr = durationMs ? ` (${durationMs}ms)` : '';
      const opSuffix = _opSuffix(opIcon);

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.log(`${_emojiPrefix(config.emoji)}${prefix} ${DECO_DONE}${message}${timeStr}${opSuffix}`);
      }
      emitJSON('info', component, message, { phase: phaseStr, phase_label: label, duration_ms: durationMs, status: 'done' });
    },

    /**
     * Log an error in a phase with optional operation type
     */
    error: (phase, message, err = null, op = null) => {
      if (!shouldEmit('error', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;
      const errMsg = err?.message || err || '';
      const opSuffix = _opSuffix(op);

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.error(`${_emojiPrefix(config.emoji)}${prefix} ${DECO_ERR}${message}${errMsg ? `: ${errMsg}` : ''}${opSuffix}`);
      }
      emitJSON('error', component, message, { phase: phaseStr, error: errMsg ? String(errMsg) : null });
    },

    /**
     * Log a warning in a phase with optional operation type
     */
    warn: (phase, message, op = null) => {
      if (!shouldEmit('warn', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;
      const opSuffix = _opSuffix(op);

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.warn(`${_emojiPrefix(config.emoji)}${prefix} ${DECO_WARN}${message}${opSuffix}`);
      }
      emitJSON('warn', component, message, { phase: phaseStr });
    },

    /**
     * Log workflow start
     */
    start: (context) => {
      if (!shouldEmit('info', component)) return;
      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.log(`\n${_emojiPrefix(config.emoji)}═══════════════════════════════════════════════════════`);
        console.log(`${_emojiPrefix(config.emoji)}[${_componentLabel(component)}] START: ${context}`);
        console.log(`${_emojiPrefix(config.emoji)}═══════════════════════════════════════════════════════`);
      }
      emitJSON('info', component, 'START', { context: String(context ?? '') });
    },

    /**
     * Log workflow complete
     */
    complete: (summary, totalMs = null) => {
      if (!shouldEmit('info', component)) return;
      const timeStr = totalMs ? ` (${totalMs}ms)` : '';
      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.log(`${_emojiPrefix(config.emoji)}───────────────────────────────────────────────────────`);
        console.log(`${_emojiPrefix(config.emoji)}[${_componentLabel(component)}] ${DECO_DONE}COMPLETE: ${summary}${timeStr}`);
        console.log(`${_emojiPrefix(config.emoji)}───────────────────────────────────────────────────────\n`);
      }
      emitJSON('info', component, summary, { status: 'complete', duration_ms: totalMs });
    },

    /**
     * Simple info log (no phase) with optional operation type
     */
    info: (message, dataOrOp = null) => {
      if (!shouldEmit('info', component)) return;
      const isOpIcon = typeof dataOrOp === 'string' && Object.values(OP).includes(dataOrOp);
      const opSuffix = isOpIcon ? _opSuffix(dataOrOp) : '';
      const data = isOpIcon ? null : dataOrOp;

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        if (data) {
          console.log(`${_emojiPrefix(config.emoji)}[${_componentLabel(component)}] ${message}`, data);
        } else {
          console.log(`${_emojiPrefix(config.emoji)}[${_componentLabel(component)}] ${message}${opSuffix}`);
        }
      }
      emitJSON('info', component, message);
    },

    /**
     * 2026-04-27 (Commit 1): Debug-level log. New first-class method.
     * Off by default — enable via LOG_LEVEL=debug or LOG_VERBOSE_COMPONENTS=<this component>.
     * New code that wants its lines silenceable by default should use this instead of info().
     */
    debug: (message, dataOrOp = null) => {
      if (!shouldEmit('debug', component)) return;
      const isOpIcon = typeof dataOrOp === 'string' && Object.values(OP).includes(dataOrOp);
      const opSuffix = isOpIcon ? _opSuffix(dataOrOp) : '';
      const data = isOpIcon ? null : dataOrOp;

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        if (data) {
          console.debug(`${_emojiPrefix(config.emoji)}[${_componentLabel(component)}] ${message}`, data);
        } else {
          console.debug(`${_emojiPrefix(config.emoji)}[${_componentLabel(component)}] ${message}${opSuffix}`);
        }
      }
      emitJSON('debug', component, message);
    },

    /**
     * Log an API call (convenience method)
     */
    api: (phase, apiName, context = '') => {
      if (!shouldEmit('info', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;
      const contextStr = context ? `: ${context}` : '';

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.log(`${_emojiPrefix(config.emoji)}${prefix} ${apiName}${contextStr}${_opSuffix(OP.API)}`);
      }
      emitJSON('info', component, apiName, { phase: phaseStr, op: 'api', context: String(context) });
    },

    /**
     * Log an AI model call (convenience method)
     */
    ai: (phase, role, context = '') => {
      if (!shouldEmit('info', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;
      const contextStr = context ? `: ${context}` : '';

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.log(`${_emojiPrefix(config.emoji)}${prefix} Calling ${role}${contextStr}${_opSuffix(OP.AI)}`);
      }
      emitJSON('info', component, `Calling ${role}`, { phase: phaseStr, op: 'ai', role: String(role), context: String(context) });
    },

    /**
     * Log a database operation (convenience method)
     */
    db: (phase, operation, context = '') => {
      if (!shouldEmit('info', component)) return;
      const label = PHASE_LABELS[`${component}:${phase}`] || '';
      const phaseStr = `${phase}/${config.phases}`;
      const prefix = `[${_componentLabel(component)}]`;
      const contextStr = context ? `: ${context}` : '';

      if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
        console.log(`${_emojiPrefix(config.emoji)}${prefix} ${operation}${contextStr}${_opSuffix(OP.DB)}`);
      }
      emitJSON('info', component, operation, { phase: phaseStr, op: 'db', context: String(context) });
    },
  };
}

// Pre-configured loggers for common workflows
export const locationLog = createWorkflowLogger('LOCATION');
export const userLog = createWorkflowLogger('USER');
export const snapshotLog = createWorkflowLogger('SNAPSHOT');
// 2026-04-28 (memory 233): TRIAD retired in favor of STRATEGY. The triadLog
// export is now a back-compat alias pointing at strategyLog so the 3 caller
// files (consolidator.js, strategy-utils.js, blocks-fast.js) continue to
// work without code changes. Visible emit bracket is now [STRATEGY].
export const strategyLog = createWorkflowLogger('STRATEGY');
export const triadLog = strategyLog;
export const venuesLog = createWorkflowLogger('VENUES');
export const barsLog = createWorkflowLogger('BARS');
export const briefingLog = createWorkflowLogger('BRIEFING');
export const eventsLog = createWorkflowLogger('EVENTS');
export const weatherLog = createWorkflowLogger('WEATHER');
export const aiLog = createWorkflowLogger('AI');
export const dbLog = createWorkflowLogger('DB');
export const authLog = createWorkflowLogger('AUTH');
export const sseLog = createWorkflowLogger('SSE');
export const phaseLog = createWorkflowLogger('PHASE');
export const placesLog = createWorkflowLogger('PLACES');
export const routesLog = createWorkflowLogger('ROUTES');

// ==========================================================
// withContext() — NEW API for request/snapshot correlation
// 2026-04-27 (Commit 1): payload-shape methods that auto-bind request_id,
// snapshot_id, route into every emission. Independent of the positional
// API above. New code (Commit 2's waterfall phase work) uses this.
//
// Usage:
//   const log = withContext({ request_id: req.id, snapshot_id: snap.id, route: '/api/snapshot' });
//   log.info({ component: 'SNAPSHOT', phase: 'SNAPSHOT', phase_index: 1, phase_total: 5, message: 'Start' });
//   log.warn({ component: 'WATERFALL', message: 'Out of order' });
// ==========================================================

function formatContextStr(ctx) {
  const parts = [];
  if (ctx.request_id) parts.push(`req=${ctx.request_id}`);
  if (ctx.snapshot_id) parts.push(`snap=${ctx.snapshot_id}`);
  if (ctx.route) parts.push(`route=${ctx.route}`);
  return parts.length ? parts.join(' ') : '';
}

function emitContextual(level, context, payload) {
  const { component = 'GENERIC', message = '', phase, phase_index, phase_total, ...meta } = payload || {};
  if (!shouldEmit(level, component)) return;

  const merged = { ...context, ...meta };
  const ctxStr = formatContextStr(merged);
  // 2026-04-27: Title-Case display label per CLEAR_CONSOLE_WORKFLOW format spec.
  // Commit 5 refinement: drop phase numbering from pretty bracket. Phase index
  // and total are still in JSON output for queryability.
  const labelSource = phase || component;
  const display = _componentLabel(labelSource);
  const phaseStr = display;

  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    const compConfig = WORKFLOWS[component] || { emoji: '📋' };
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase()} ${_emojiPrefix(compConfig.emoji)}[${phaseStr}${ctxStr ? ' ' + ctxStr : ''}] ${message}`;
    const sink = level === 'error' ? console.error
               : level === 'warn'  ? console.warn
               : level === 'debug' ? console.debug
               : console.log;
    sink(line);
  }
  emitJSON(level, component, message, { phase, phase_index, phase_total, ...merged });
}

/**
 * Returns a logger with bound context (request_id, snapshot_id, route).
 * Each emission is gated through shouldEmit() and includes the bound context.
 */
export function withContext(context = {}) {
  return {
    debug: (payload) => emitContextual('debug', context, payload),
    info:  (payload) => emitContextual('info',  context, payload),
    warn:  (payload) => emitContextual('warn',  context, payload),
    error: (payload) => emitContextual('error', context, payload),
  };
}

// ==========================================================
// Top-level helpers (existing API preserved, gated through shouldEmit)
// ==========================================================

/**
 * Log AI model call with standardized format
 */
export function logAICall(role, model, purpose) {
  if (!shouldEmit('info', 'AI')) return;
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix('🤖')}[AI] Calling ${role} (${model}): ${purpose}${_opSuffix(OP.AI)}`);
  }
  emitJSON('info', 'AI', `Calling ${role}`, { role: String(role), model: String(model), purpose: String(purpose) });
}

/**
 * Log AI model response
 */
export function logAIResponse(role, model, responseLen, durationMs) {
  if (!shouldEmit('info', 'AI')) return;
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix('🤖')}[AI] ${role} responded: ${responseLen} chars (${durationMs}ms)${_opSuffix(OP.AI)}`);
  }
  emitJSON('info', 'AI', `${role} responded`, { role: String(role), model: String(model), response_len: responseLen, duration_ms: durationMs });
}

/**
 * Log venue-specific operations
 */
export function logVenue(venueName, operation, result, op = null) {
  if (!shouldEmit('info', 'VENUES')) return;
  const shortName = String(venueName).length > 30 ? String(venueName).slice(0, 27) + '...' : String(venueName);
  const opSuffix = _opSuffix(op);
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix('🏢')}[Venue "${shortName}"] ${operation}: ${result}${opSuffix}`);
  }
  emitJSON('info', 'VENUES', operation, { venue: shortName, result: String(result) });
}

/**
 * Log an external API call (Google, etc.)
 */
export function logAPICall(apiName, context) {
  if (!shouldEmit('info', 'API')) return;
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix('🌐')}[API] ${apiName}: ${context}${_opSuffix(OP.API)}`);
  }
  emitJSON('info', 'API', String(apiName), { context: String(context) });
}

/**
 * Log an external API response
 */
export function logAPIResponse(apiName, result, durationMs = null) {
  if (!shouldEmit('info', 'API')) return;
  const timeStr = durationMs ? ` (${durationMs}ms)` : '';
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix('🌐')}[API] ${apiName}: ${result}${timeStr}${_opSuffix(OP.API)}`);
  }
  emitJSON('info', 'API', String(apiName), { result: String(result), duration_ms: durationMs });
}

/**
 * Log a database operation
 */
export function logDB(operation, table, context = '') {
  if (!shouldEmit('info', 'DB')) return;
  const contextStr = context ? `: ${context}` : '';
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix('💾')}[DB] ${operation} ${table}${contextStr}${_opSuffix(OP.DB)}`);
  }
  emitJSON('info', 'DB', String(operation), { table: String(table), context: String(context) });
}

/**
 * Log a cache operation
 */
export function logCache(type, key) {
  if (!shouldEmit('info', 'CACHE')) return;
  const icon = type === 'HIT' ? '⚡' : '🔍';
  if (LOG_FORMAT === 'pretty' || LOG_FORMAT === 'both') {
    console.log(`${_emojiPrefix(icon)}[Cache] ${type}: ${key}${_opSuffix(OP.CACHE)}`);
  }
  emitJSON('info', 'CACHE', String(type), { key: String(key) });
}

// ==========================================================
// WATERFALL PHASE CONTRACT
// 2026-04-27 (Commit 2 of CLEAR_CONSOLE_WORKFLOW spec):
// Numbered 5-phase pipeline taxonomy + per-(request,snapshot) order guard.
// Emits warnings on duplicate phase-starts and out-of-order phase-starts.
//
// Usage:
//   markPhaseStart({ request_id, snapshot_id, phase: 'SNAPSHOT', meta: { route } });
//   ... do snapshot work ...
//   markPhaseComplete({ request_id, snapshot_id, phase: 'SNAPSHOT', meta: { city, state } });
//
// Strict order: SNAPSHOT → BRIEFING → STRATEGY → VENUE_PLANNING → WATERFALL
// Any phase that starts while an earlier phase is incomplete logs a warning;
// duplicate starts of the same phase log a warning. Execution is NOT blocked —
// the goal is to make duplicate/out-of-order traffic impossible to miss in logs.
// ==========================================================

// 2026-04-27 (Commit 5): Renamed VENUE_PLANNING -> VENUE. Bracket reads as
// "[Venue] Called Venue Planner" — main category is one word, "Venue Planner"
// is the role surfaced in the message.
export const WATERFALL_PHASES = {
  SNAPSHOT: { index: 1, total: 5, label: 'SNAPSHOT' },
  BRIEFING: { index: 2, total: 5, label: 'BRIEFING' },
  STRATEGY: { index: 3, total: 5, label: 'STRATEGY' },
  VENUE:    { index: 4, total: 5, label: 'VENUE' },
  WATERFALL:{ index: 5, total: 5, label: 'WATERFALL' },
};

// Per-(request, snapshot) state. Cleared 5s after WATERFALL completes
// so long-running processes don't accumulate Map entries indefinitely.
const _phaseState = new Map();

function _phaseKey(request_id, snapshot_id) {
  return `${request_id || 'unknown'}:${snapshot_id || 'unknown'}`;
}

function _getOrCreatePhaseState(key) {
  let state = _phaseState.get(key);
  if (!state) {
    state = { completed: new Set(), started: new Set(), startTimes: new Map() };
    _phaseState.set(key, state);
  }
  return state;
}

/**
 * Mark a waterfall phase as started. Emits the start line plus any
 * applicable WARN lines (duplicate-start, out-of-order).
 *
 * @param {Object} args
 * @param {string} [args.request_id] - request correlation id
 * @param {string} [args.snapshot_id] - snapshot correlation id
 * @param {keyof WATERFALL_PHASES} args.phase - one of SNAPSHOT|BRIEFING|STRATEGY|VENUE_PLANNING|WATERFALL
 * @param {string} [args.message='Start'] - message to emit (typically 'Start' or a sub-step name)
 * @param {Object} [args.meta] - additional structured fields (route, etc.)
 */
export function markPhaseStart({ request_id, snapshot_id, phase, message = 'Start', meta = {} }) {
  const cfg = WATERFALL_PHASES[phase];
  if (!cfg) {
    emitContextual('warn', { request_id, snapshot_id }, {
      component: 'WATERFALL',
      message: `markPhaseStart: unknown phase "${phase}"`,
    });
    return;
  }

  const key = _phaseKey(request_id, snapshot_id);
  const state = _getOrCreatePhaseState(key);

  // Duplicate-start detection
  if (state.started.has(phase) && !state.completed.has(phase)) {
    emitContextual('warn', { request_id, snapshot_id }, {
      component: 'WATERFALL',
      phase,
      phase_index: cfg.index,
      phase_total: cfg.total,
      message: `Duplicate start detected for ${_componentLabel(phase)}`,
    });
  }

  // Out-of-order detection: every lower-index phase must be completed
  for (const [name, otherCfg] of Object.entries(WATERFALL_PHASES)) {
    if (otherCfg.index < cfg.index && !state.completed.has(name)) {
      emitContextual('warn', { request_id, snapshot_id }, {
        component: 'WATERFALL',
        phase,
        phase_index: cfg.index,
        phase_total: cfg.total,
        message: `${_componentLabel(phase)} started before ${_componentLabel(name)} complete`,
      });
    }
  }

  state.started.add(phase);
  state.startTimes.set(phase, Date.now());

  // Emit the start line itself
  emitContextual('info', { request_id, snapshot_id, ...meta }, {
    component: phase,
    phase,
    phase_index: cfg.index,
    phase_total: cfg.total,
    message,
  });
}

/**
 * Mark a waterfall phase as complete. Emits the complete line with duration_ms
 * computed from the matching markPhaseStart call. When phase==='WATERFALL',
 * the per-(request, snapshot) state is GC'd 5s later.
 */
export function markPhaseComplete({ request_id, snapshot_id, phase, message = 'Complete', meta = {} }) {
  const cfg = WATERFALL_PHASES[phase];
  if (!cfg) return;

  const key = _phaseKey(request_id, snapshot_id);
  const state = _getOrCreatePhaseState(key);
  const startTime = state.startTimes.get(phase);
  const duration_ms = startTime ? Date.now() - startTime : null;

  state.completed.add(phase);

  emitContextual('info', { request_id, snapshot_id, duration_ms, ...meta }, {
    component: phase,
    phase,
    phase_index: cfg.index,
    phase_total: cfg.total,
    message,
  });

  // GC after WATERFALL completes so long-running servers don't leak
  if (phase === 'WATERFALL') {
    setTimeout(() => _phaseState.delete(key), 5000);
  }
}

/**
 * Test/debug helper — returns a snapshot of the in-memory phase state.
 * Not part of the production API.
 */
export function _debugPhaseState() {
  const out = {};
  for (const [key, state] of _phaseState.entries()) {
    out[key] = {
      started: Array.from(state.started),
      completed: Array.from(state.completed),
    };
  }
  return out;
}
