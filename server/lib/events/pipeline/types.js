/**
 * server/lib/events/pipeline/types.js
 *
 * Canonical event type definitions for the ETL pipeline.
 *
 * ETL ARCHITECTURE:
 * ═══════════════════════════════════════════════════════════════════════════
 * RawEvent (from providers) → NormalizedEvent → ValidatedEvent → StoredEvent
 *                                                                    ↓
 * BriefingEvent ← (DB read) ← discovered_events table ← (DB write)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * INVARIANT: Strategy LLMs ONLY receive BriefingEvent from DB rows.
 * Raw provider payloads are NEVER passed to strategy LLMs.
 *
 * @module server/lib/events/pipeline/types
 */

/**
 * Raw event as returned by discovery providers (SerpAPI, Gemini, Claude, etc.)
 * This format varies by provider - normalization is required before storage.
 *
 * @typedef {Object} RawEvent
 * @property {string} [title] - Event title (may include quotes, prefixes)
 * @property {string} [name] - Alternative title field
 * @property {string} [venue] - Venue name (provider format)
 * @property {string} [venue_name] - Alternative venue field
 * @property {string} [location] - Location string (format varies)
 * @property {string} [address] - Address (format varies)
 * @property {string} [event_date] - Date string (format varies: YYYY-MM-DD, MM/DD/YYYY, etc.)
 * @property {string} [date] - Alternative date field
 * @property {string} [event_time] - Time string (format varies: "7 PM", "19:00", etc.)
 * @property {string} [time] - Alternative time field
 * @property {string} [event_end_time] - End time (optional)
 * @property {number|string} [lat] - Latitude (may be string)
 * @property {number|string} [lng] - Longitude (may be string)
 * @property {number|string} [latitude] - Alternative lat field
 * @property {number|string} [longitude] - Alternative lng field
 * @property {string} [category] - Event category
 * @property {string} [subtype] - Event subtype
 * @property {string} [expected_attendance] - Attendance estimate
 * @property {string} [impact] - Driver impact (high/medium/low)
 * @property {string} [source_model] - Which AI model discovered this
 * @property {string} [source_url] - Source URL if available
 * @property {Object} [raw_source_data] - Original provider response (for audit only)
 */

/**
 * Normalized event - canonical field names and formats.
 * This is the internal representation used for validation and hashing.
 *
 * @typedef {Object} NormalizedEvent
 * @property {string} title - Cleaned title (no quotes, trimmed)
 * @property {string} venue_name - Canonical venue name
 * @property {string} address - Full address string
 * @property {string} city - City name
 * @property {string} state - State code (2-letter)
 * @property {string|null} zip - ZIP code if available
 * @property {string} event_date - Date in YYYY-MM-DD format
 * @property {string} event_time - Time in HH:MM format (24h)
 * @property {string|null} event_end_time - End time in HH:MM format
 * @property {string|null} event_end_date - End date if multi-day
 * @property {number|null} lat - Latitude (6 decimal precision)
 * @property {number|null} lng - Longitude (6 decimal precision)
 * @property {string} category - Normalized category
 * @property {string} expected_attendance - high/medium/low
 * @property {string} source_model - Provider identifier
 * @property {string|null} source_url - Source URL
 * @property {Object|null} raw_source_data - Original response (audit only)
 */

/**
 * Validated event - passed all hard filters, ready for hashing/storage.
 *
 * @typedef {NormalizedEvent} ValidatedEvent
 * Additional guarantee: All required fields are non-TBD, non-empty.
 */

/**
 * Stored event - the discovered_events table row format.
 * Includes event_hash for deduplication.
 *
 * @typedef {Object} StoredEvent
 * @property {string} id - UUID primary key
 * @property {string} event_hash - MD5 hash of normalized(title|venue|date|city)
 * @property {string} title
 * @property {string} venue_name
 * @property {string} address
 * @property {string} city
 * @property {string} state
 * @property {string|null} zip
 * @property {string} event_date
 * @property {string} event_time
 * @property {string|null} event_end_time
 * @property {string|null} event_end_date
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {string} category
 * @property {string} expected_attendance
 * @property {string} source_model
 * @property {string|null} source_url
 * @property {Object|null} raw_source_data - NEVER sent to LLMs
 * @property {string|null} venue_id - FK to venue_catalog
 * @property {boolean} is_active
 * @property {Date} discovered_at
 * @property {Date} updated_at
 */

/**
 * Briefing event - the format used in briefings table and sent to LLMs.
 * This is the ONLY event format that strategy LLMs receive.
 *
 * INVARIANT: BriefingEvent contains NO raw_source_data.
 *
 * @typedef {Object} BriefingEvent
 * @property {string} title
 * @property {string} summary - Human-readable summary
 * @property {string} impact - high/medium/low
 * @property {string} source - Provider name (not raw data)
 * @property {string} event_type - Category for grouping
 * @property {string} subtype - Subtype for filtering
 * @property {string} event_date
 * @property {string} event_time
 * @property {string|null} event_end_time
 * @property {string} address
 * @property {string} venue - Venue name
 * @property {string} location - "venue, address" combined
 * @property {number|null} latitude
 * @property {number|null} longitude
 */

/**
 * Event processing result - returned by pipeline functions
 *
 * @typedef {Object} EventProcessingResult
 * @property {boolean} ok - Whether processing succeeded
 * @property {Array<ValidatedEvent>} events - Processed events
 * @property {number} total - Total events before processing
 * @property {number} valid - Valid events after processing
 * @property {number} invalid - Invalid events removed
 * @property {Array<string>} [errors] - Error messages for invalid events
 */

/**
 * Discovery provider configuration
 *
 * @typedef {Object} DiscoveryProviderConfig
 * @property {string} adapter - Adapter name (gemini, openai, anthropic, serpapi)
 * @property {string} modelId - Model identifier from env config
 * @property {string} toolchain - Tool capability (google_search, web_search, serp, none)
 * @property {boolean} supportsSemanticDedup - Whether provider can receive existing events
 */

// Export empty object for ESM compatibility (types are JSDoc only)
export default {};
