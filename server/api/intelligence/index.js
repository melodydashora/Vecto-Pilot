/**
 * Market Intelligence API
 *
 * Provides access to market-specific intelligence data including:
 * - Zone information (honey holes, danger zones, dead zones)
 * - Regulatory context (Prop 22, TLC rules)
 * - Strategy advice per market
 * - Safety information
 * - Algorithm mechanics
 *
 * Routes:
 *   GET /api/intelligence                    - List all intelligence (with filters)
 *   GET /api/intelligence/markets            - List all markets with intel count
 *   GET /api/intelligence/for-location       - Get intel for a city → market lookup (2026-01-05)
 *   GET /api/intelligence/market/:slug       - Get intelligence for a specific market
 *   GET /api/intelligence/coach/:market      - Get AI Coach context for a market
 *   GET /api/intelligence/staging-areas      - Get staging areas from ranking_candidates
 *   GET /api/intelligence/:id                - Get a specific intelligence item
 *   POST /api/intelligence                   - Create new intelligence (admin/coach)
 *   PUT /api/intelligence/:id                - Update intelligence item
 *
 * City → Market Lookup (2026-01-05):
 *   - Uses us_market_cities table to map cities to their market anchor
 *   - Example: Frisco, TX → Dallas market
 *   - Supports both full state names ("Texas") and abbreviations ("TX")
 */

import express from 'express';
import { db } from '../../db/drizzle.js';
import { market_intelligence, platform_data, ranking_candidates, us_market_cities, market_intel } from '../../../shared/schema.js';
import { eq, and, or, ilike, sql, desc, asc, isNotNull } from 'drizzle-orm';

const router = express.Router();

// Valid intel types
const INTEL_TYPES = ['regulatory', 'strategy', 'zone', 'timing', 'airport', 'safety', 'algorithm', 'vehicle', 'general'];
const ZONE_SUBTYPES = ['honey_hole', 'danger_zone', 'dead_zone', 'safe_corridor', 'caution_zone'];

/**
 * GET /api/intelligence
 * List all intelligence with optional filters
 *
 * Query params:
 *   market      - Filter by market slug
 *   platform    - Filter by platform (uber, lyft, both)
 *   type        - Filter by intel_type
 *   subtype     - Filter by intel_subtype (for zones)
 *   tags        - Filter by tags (comma-separated)
 *   active      - Filter by is_active (default: true)
 *   coach       - Filter by coach_can_cite (for AI Coach context)
 *   search      - Search in title and content
 *   limit       - Max results (default: 50, max: 200)
 *   offset      - Pagination offset
 *   sort        - Sort by field (priority, created_at, confidence)
 */
router.get('/', async (req, res) => {
  try {
    const {
      market,
      platform,
      type,
      subtype,
      tags,
      active = 'true',
      coach,
      search,
      limit = 50,
      offset = 0,
      sort = 'priority',
    } = req.query;

    const conditions = [];

    // Active filter (default true)
    if (active !== 'all') {
      conditions.push(eq(market_intelligence.is_active, active === 'true'));
    }

    // Market filter
    if (market) {
      conditions.push(eq(market_intelligence.market_slug, market));
    }

    // Platform filter
    if (platform && ['uber', 'lyft', 'both'].includes(platform)) {
      conditions.push(
        or(
          eq(market_intelligence.platform, platform),
          eq(market_intelligence.platform, 'both')
        )
      );
    }

    // Type filter
    if (type && INTEL_TYPES.includes(type)) {
      conditions.push(eq(market_intelligence.intel_type, type));
    }

    // Subtype filter
    if (subtype && ZONE_SUBTYPES.includes(subtype)) {
      conditions.push(eq(market_intelligence.intel_subtype, subtype));
    }

    // Coach filter
    if (coach === 'true') {
      conditions.push(eq(market_intelligence.coach_can_cite, true));
    }

    // Search filter
    if (search && search.length >= 2) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(market_intelligence.title, searchPattern),
          ilike(market_intelligence.content, searchPattern),
          ilike(market_intelligence.summary, searchPattern)
        )
      );
    }

    // Build query
    let query = db
      .select()
      .from(market_intelligence)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(Math.min(parseInt(limit) || 50, 200))
      .offset(parseInt(offset) || 0);

    // Sorting
    switch (sort) {
      case 'priority':
        query = query.orderBy(desc(market_intelligence.priority));
        break;
      case 'confidence':
        query = query.orderBy(desc(market_intelligence.confidence));
        break;
      case 'created_at':
        query = query.orderBy(desc(market_intelligence.created_at));
        break;
      case 'coach_priority':
        query = query.orderBy(desc(market_intelligence.coach_priority));
        break;
      default:
        query = query.orderBy(desc(market_intelligence.priority));
    }

    const intelligence = await query;

    // Get total count for pagination
    const countResult = await db
      .select({ count: sql`count(*)` })
      .from(market_intelligence)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({
      total: parseInt(countResult[0].count),
      limit: Math.min(parseInt(limit) || 50, 200),
      offset: parseInt(offset) || 0,
      intelligence,
    });
  } catch (error) {
    console.error('Error fetching intelligence:', error);
    res.status(500).json({ error: 'Failed to fetch intelligence' });
  }
});

/**
 * GET /api/intelligence/markets
 * List all markets with intelligence count
 */
router.get('/markets', async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        market_slug,
        market,
        COUNT(*) as intel_count,
        COUNT(*) FILTER (WHERE intel_type = 'zone') as zone_count,
        COUNT(*) FILTER (WHERE intel_type = 'safety') as safety_count,
        COUNT(*) FILTER (WHERE intel_type = 'strategy') as strategy_count
      FROM market_intelligence
      WHERE is_active = true
      GROUP BY market_slug, market
      ORDER BY intel_count DESC
    `);

    res.json({
      markets: result.rows,
    });
  } catch (error) {
    console.error('Error fetching intelligence markets:', error);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

/**
 * GET /api/intelligence/markets-dropdown
 * Get list of all US markets for signup dropdown
 *
 * 2026-01-05: Returns unique market names from us_market_cities table
 *
 * Returns array of markets sorted alphabetically, with "Other" option hint
 * Client should add "Other" as final option and show free-text input if selected
 */
router.get('/markets-dropdown', async (_req, res) => {
  try {
    const result = await db
      .selectDistinct({ market_name: us_market_cities.market_name })
      .from(us_market_cities)
      .orderBy(asc(us_market_cities.market_name));

    res.json({
      markets: result.map(r => r.market_name),
      total: result.length,
      hint: 'Add "Other" as final option in dropdown. If selected, show free-text input for new market.'
    });
  } catch (error) {
    console.error('Error fetching markets dropdown:', error);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

/**
 * POST /api/intelligence/add-market
 * Add a new market when user selects "Other" during signup
 *
 * 2026-01-05: Allows capturing new markets from user input
 *
 * Body:
 *   market_name - New market name (e.g., "Timbuktu")
 *   city        - User's city (optional, to create first city mapping)
 *   state       - User's state (optional)
 */
router.post('/add-market', async (req, res) => {
  try {
    const { market_name, city, state, state_abbr } = req.body;

    if (!market_name || market_name.trim().length < 2) {
      return res.status(400).json({ error: 'Market name is required (min 2 characters)' });
    }

    const trimmedMarket = market_name.trim();

    // Check if market already exists
    const existing = await db
      .select()
      .from(us_market_cities)
      .where(ilike(us_market_cities.market_name, trimmedMarket))
      .limit(1);

    if (existing.length > 0) {
      return res.json({
        success: true,
        message: 'Market already exists',
        market_name: existing[0].market_name,
        already_existed: true
      });
    }

    // Add new market with optional city mapping
    const newEntry = {
      market_name: trimmedMarket,
      city: city?.trim() || trimmedMarket, // Default city to market name
      state: state?.trim() || 'Unknown',
      state_abbr: state_abbr?.trim() || null,
      region_type: 'Core', // New market, user's city is the core
      source_ref: 'user_signup'
    };

    await db.insert(us_market_cities).values(newEntry);

    res.json({
      success: true,
      message: 'New market added',
      market_name: trimmedMarket,
      already_existed: false
    });
  } catch (error) {
    console.error('Error adding new market:', error);
    res.status(500).json({ error: 'Failed to add market' });
  }
});

/**
 * GET /api/intelligence/for-location
 * Get market intelligence for a specific city/state
 *
 * 2026-01-05: New endpoint that uses us_market_cities lookup
 *
 * Query params:
 *   city     - City name (e.g., "Frisco")
 *   state    - State name or abbreviation (e.g., "Texas" or "TX")
 *   type     - Filter by intel_type (optional)
 *   platform - Filter by platform (optional)
 *   limit    - Max results (default: 20)
 *
 * Returns:
 *   - The resolved market for the city
 *   - Market intelligence items
 *   - Market-level intel from market_intel table
 *
 * Example: GET /api/intelligence/for-location?city=Frisco&state=TX
 *   → Returns Dallas market intel (Frisco is a satellite of Dallas)
 */
router.get('/for-location', async (req, res) => {
  try {
    const { city, state, type, platform, limit = 20 } = req.query;

    // Validate required params
    if (!city || !state) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Both city and state are required',
        example: '/api/intelligence/for-location?city=Frisco&state=TX'
      });
    }

    // Normalize state: could be "Texas" or "TX"
    // We store both state (full name) and state_abbr (abbreviation) in us_market_cities
    const stateCondition = state.length === 2
      ? eq(us_market_cities.state_abbr, state.toUpperCase())
      : ilike(us_market_cities.state, state);

    // Look up the market for this city
    const [marketMapping] = await db
      .select()
      .from(us_market_cities)
      .where(and(
        ilike(us_market_cities.city, city),
        stateCondition
      ))
      .limit(1);

    if (!marketMapping) {
      return res.status(404).json({
        error: 'City not found in market database',
        city,
        state,
        message: 'This city is not in our US market cities database. Intel not available.',
        suggestion: 'Try a nearby major city or the market anchor city.'
      });
    }

    const { market_name, region_type, state: fullState, state_abbr } = marketMapping;

    // Now look up intel for this market
    // IMPORTANT: market_intelligence uses different naming conventions:
    //   - "Dallas-Fort Worth" (combined) vs us_market_cities "Dallas" or "Fort Worth" (separate)
    //   - market_slug: "dallas-fort-worth"
    //
    // 2026-01-05: Use flexible matching to handle naming mismatches:
    //   - "Dallas" should match "Dallas-Fort Worth"
    //   - "Fort Worth" should match "Dallas-Fort Worth"
    //   - Also match "Universal" intel that applies to all markets
    const marketPattern = `%${market_name}%`;  // "Dallas" → "%Dallas%"
    const slugPattern = market_name.toLowerCase().replace(/\s+/g, '-'); // "Fort Worth" → "fort-worth"

    const conditions = [
      eq(market_intelligence.is_active, true),
      or(
        // Exact match on market name
        ilike(market_intelligence.market, market_name),
        // Partial match: "Dallas" matches "Dallas-Fort Worth"
        ilike(market_intelligence.market, marketPattern),
        // Partial match on slug: "dallas" matches "dallas-fort-worth"
        sql`${market_intelligence.market_slug} LIKE '%' || ${slugPattern} || '%'`,
        // Universal intel applies to ALL markets
        eq(market_intelligence.market_slug, 'universal')
      )
    ];

    if (type && ['regulatory', 'strategy', 'zone', 'timing', 'airport', 'safety', 'algorithm', 'vehicle', 'general'].includes(type)) {
      conditions.push(eq(market_intelligence.intel_type, type));
    }

    if (platform && ['uber', 'lyft', 'both'].includes(platform)) {
      conditions.push(
        or(
          eq(market_intelligence.platform, platform),
          eq(market_intelligence.platform, 'both')
        )
      );
    }

    const intelligence = await db
      .select()
      .from(market_intelligence)
      .where(and(...conditions))
      .orderBy(desc(market_intelligence.priority))
      .limit(Math.min(parseInt(limit) || 20, 50));

    // Also fetch from market_intel (our new simplified intel table)
    const marketInsights = await db
      .select()
      .from(market_intel)
      .where(and(
        eq(market_intel.is_active, true),
        ilike(market_intel.market_name, market_name)
      ))
      .orderBy(asc(market_intel.priority))
      .limit(Math.min(parseInt(limit) || 20, 50));

    // Get all cities in this market (for context)
    const marketCities = await db
      .select({
        city: us_market_cities.city,
        region_type: us_market_cities.region_type
      })
      .from(us_market_cities)
      .where(eq(us_market_cities.market_name, market_name))
      .orderBy(desc(sql`CASE WHEN region_type = 'Core' THEN 1 ELSE 2 END`), asc(us_market_cities.city));

    // Group intelligence by type
    const byType = {};
    for (const item of intelligence) {
      if (!byType[item.intel_type]) {
        byType[item.intel_type] = [];
      }
      byType[item.intel_type].push(item);
    }

    res.json({
      // Location resolution
      location: {
        input_city: city,
        input_state: state,
        resolved_market: market_name,
        region_type: region_type,
        full_state: fullState,
        state_abbr: state_abbr,
      },
      // Market context
      market: {
        name: market_name,
        total_cities: marketCities.length,
        core_cities: marketCities.filter(c => c.region_type === 'Core').map(c => c.city),
        satellite_cities_sample: marketCities
          .filter(c => c.region_type === 'Satellite')
          .slice(0, 10)
          .map(c => c.city),
      },
      // Intelligence data
      intel_count: intelligence.length,
      insights_count: marketInsights.length,
      by_type: byType,
      intelligence,
      // Market-level insights from market_intel table
      market_insights: marketInsights,
    });
  } catch (error) {
    console.error('Error fetching intelligence for location:', error);
    res.status(500).json({ error: 'Failed to fetch intelligence for location' });
  }
});

/**
 * GET /api/intelligence/market/:slug
 * Get all intelligence for a specific market
 *
 * Query params:
 *   type     - Filter by intel_type
 *   platform - Filter by platform
 */
router.get('/market/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { type, platform } = req.query;

    const conditions = [
      eq(market_intelligence.market_slug, slug),
      eq(market_intelligence.is_active, true),
    ];

    if (type && INTEL_TYPES.includes(type)) {
      conditions.push(eq(market_intelligence.intel_type, type));
    }

    if (platform && ['uber', 'lyft', 'both'].includes(platform)) {
      conditions.push(
        or(
          eq(market_intelligence.platform, platform),
          eq(market_intelligence.platform, 'both')
        )
      );
    }

    const intelligence = await db
      .select()
      .from(market_intelligence)
      .where(and(...conditions))
      .orderBy(desc(market_intelligence.priority));

    if (intelligence.length === 0) {
      return res.status(404).json({ error: 'Market not found or no intelligence available' });
    }

    // Group by type
    const grouped = {};
    for (const item of intelligence) {
      if (!grouped[item.intel_type]) {
        grouped[item.intel_type] = [];
      }
      grouped[item.intel_type].push(item);
    }

    res.json({
      market: slug,
      market_name: intelligence[0]?.market,
      total_items: intelligence.length,
      by_type: grouped,
      intelligence,
    });
  } catch (error) {
    console.error('Error fetching market intelligence:', error);
    res.status(500).json({ error: 'Failed to fetch market intelligence' });
  }
});

/**
 * GET /api/intelligence/coach/:market
 * Get AI Coach context for a specific market
 * Returns high-priority, coach-citable intelligence formatted for LLM context
 */
router.get('/coach/:market', async (req, res) => {
  try {
    const { market } = req.params;
    const { platform = 'both', limit = 20 } = req.query;

    const conditions = [
      or(
        eq(market_intelligence.market_slug, market),
        eq(market_intelligence.market_slug, 'universal')
      ),
      eq(market_intelligence.is_active, true),
      eq(market_intelligence.coach_can_cite, true),
    ];

    if (platform !== 'both') {
      conditions.push(
        or(
          eq(market_intelligence.platform, platform),
          eq(market_intelligence.platform, 'both')
        )
      );
    }

    const intelligence = await db
      .select({
        id: market_intelligence.id,
        market: market_intelligence.market,
        intel_type: market_intelligence.intel_type,
        intel_subtype: market_intelligence.intel_subtype,
        title: market_intelligence.title,
        summary: market_intelligence.summary,
        content: market_intelligence.content,
        neighborhoods: market_intelligence.neighborhoods,
        time_context: market_intelligence.time_context,
        tags: market_intelligence.tags,
        priority: market_intelligence.priority,
        confidence: market_intelligence.confidence,
        source: market_intelligence.source,
      })
      .from(market_intelligence)
      .where(and(...conditions))
      .orderBy(desc(market_intelligence.coach_priority))
      .limit(parseInt(limit) || 20);

    // Format for LLM context
    const context = intelligence.map(item => ({
      type: item.intel_type,
      subtype: item.intel_subtype,
      title: item.title,
      insight: item.summary || item.content.substring(0, 300),
      neighborhoods: item.neighborhoods,
      priority: item.priority,
      confidence: item.confidence,
    }));

    res.json({
      market,
      intel_count: intelligence.length,
      context,
      raw: intelligence,
    });
  } catch (error) {
    console.error('Error fetching coach context:', error);
    res.status(500).json({ error: 'Failed to fetch coach context' });
  }
});

/**
 * GET /api/intelligence/:id
 * Get a specific intelligence item by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [item] = await db
      .select()
      .from(market_intelligence)
      .where(eq(market_intelligence.id, id));

    if (!item) {
      return res.status(404).json({ error: 'Intelligence item not found' });
    }

    res.json(item);
  } catch (error) {
    console.error('Error fetching intelligence item:', error);
    res.status(500).json({ error: 'Failed to fetch intelligence item' });
  }
});

/**
 * POST /api/intelligence
 * Create a new intelligence item
 * Used by AI Coach and admin to add new intelligence
 */
router.post('/', async (req, res) => {
  try {
    const {
      market,
      market_slug,
      platform = 'both',
      intel_type,
      intel_subtype,
      title,
      summary,
      content,
      neighborhoods,
      boundaries,
      time_context,
      tags = [],
      priority = 50,
      source = 'coach',
      source_file,
      source_section,
      confidence = 70,
      coach_can_cite = true,
      coach_priority,
      created_by = 'coach',
    } = req.body;

    // Validation
    if (!market || !market_slug || !intel_type || !title || !content) {
      return res.status(400).json({
        error: 'Missing required fields: market, market_slug, intel_type, title, content',
      });
    }

    if (!INTEL_TYPES.includes(intel_type)) {
      return res.status(400).json({
        error: `Invalid intel_type. Must be one of: ${INTEL_TYPES.join(', ')}`,
      });
    }

    if (intel_type === 'zone' && intel_subtype && !ZONE_SUBTYPES.includes(intel_subtype)) {
      return res.status(400).json({
        error: `Invalid intel_subtype for zone. Must be one of: ${ZONE_SUBTYPES.join(', ')}`,
      });
    }

    const [newItem] = await db
      .insert(market_intelligence)
      .values({
        market,
        market_slug,
        platform,
        intel_type,
        intel_subtype,
        title,
        summary,
        content,
        neighborhoods,
        boundaries,
        time_context,
        tags,
        priority: Math.min(100, Math.max(1, priority)),
        source,
        source_file,
        source_section,
        confidence: Math.min(100, Math.max(1, confidence)),
        coach_can_cite,
        coach_priority: coach_priority || priority,
        created_by,
        is_active: true,
        is_verified: false,
        version: 1,
        effective_date: new Date(),
      })
      .returning();

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating intelligence:', error);
    res.status(500).json({ error: 'Failed to create intelligence' });
  }
});

/**
 * PUT /api/intelligence/:id
 * Update an intelligence item
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Get current item
    const [current] = await db
      .select()
      .from(market_intelligence)
      .where(eq(market_intelligence.id, id));

    if (!current) {
      return res.status(404).json({ error: 'Intelligence item not found' });
    }

    // Validate type changes
    if (updates.intel_type && !INTEL_TYPES.includes(updates.intel_type)) {
      return res.status(400).json({
        error: `Invalid intel_type. Must be one of: ${INTEL_TYPES.join(', ')}`,
      });
    }

    // Build update object
    const updateData = {
      ...updates,
      updated_at: new Date(),
      version: current.version + 1,
    };

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.created_at;
    delete updateData.created_by;

    const [updated] = await db
      .update(market_intelligence)
      .set(updateData)
      .where(eq(market_intelligence.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error('Error updating intelligence:', error);
    res.status(500).json({ error: 'Failed to update intelligence' });
  }
});

/**
 * DELETE /api/intelligence/:id
 * Soft delete an intelligence item (set is_active to false)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [updated] = await db
      .update(market_intelligence)
      .set({
        is_active: false,
        updated_at: new Date(),
      })
      .where(eq(market_intelligence.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Intelligence item not found' });
    }

    res.json({ message: 'Intelligence item deactivated', id });
  } catch (error) {
    console.error('Error deleting intelligence:', error);
    res.status(500).json({ error: 'Failed to delete intelligence' });
  }
});

/**
 * GET /api/intelligence/types
 * Get valid intelligence types and subtypes
 */
router.get('/types', async (_req, res) => {
  res.json({
    intel_types: INTEL_TYPES,
    zone_subtypes: ZONE_SUBTYPES,
  });
});

/**
 * GET /api/intelligence/lookup
 * Lookup market data for a specific city/state
 *
 * Query params:
 *   city  - City name (required)
 *   state - State name or abbreviation (optional but recommended)
 *
 * Returns:
 *   - market: The operational market this city belongs to
 *   - market_anchor: The core city that anchors this market
 *   - region_type: Core, Satellite, or Rural
 *   - market_cities: Other cities in the same market
 *   - deadhead_risk: Calculated based on region type
 */
router.get('/lookup', async (req, res) => {
  try {
    const { city, state } = req.query;

    if (!city) {
      return res.status(400).json({ error: 'City is required' });
    }

    // Build query conditions
    const conditions = [
      eq(platform_data.platform, 'uber'),
      ilike(platform_data.city, city.trim())
    ];

    // Add state filter if provided
    if (state) {
      // Handle both abbreviations and full names
      conditions.push(
        or(
          ilike(platform_data.region, state.trim()),
          ilike(platform_data.region, `%${state.trim()}%`)
        )
      );
    }

    // Find the city
    const [cityData] = await db
      .select()
      .from(platform_data)
      .where(and(...conditions))
      .limit(1);

    if (!cityData) {
      // Try fuzzy match
      const fuzzyResult = await db
        .select()
        .from(platform_data)
        .where(and(
          eq(platform_data.platform, 'uber'),
          ilike(platform_data.city, `%${city.trim()}%`)
        ))
        .limit(5);

      if (fuzzyResult.length > 0) {
        return res.json({
          found: false,
          message: `City "${city}" not found exactly. Did you mean one of these?`,
          suggestions: fuzzyResult.map(r => ({
            city: r.city,
            state: r.region,
            market: r.market
          }))
        });
      }

      return res.status(404).json({
        found: false,
        message: `No market data found for ${city}${state ? `, ${state}` : ''}`
      });
    }

    // Get other cities in the same market
    let marketCities = [];
    if (cityData.market_anchor) {
      const siblings = await db
        .select({
          city: platform_data.city,
          region: platform_data.region,
          region_type: platform_data.region_type
        })
        .from(platform_data)
        .where(and(
          eq(platform_data.platform, 'uber'),
          eq(platform_data.market_anchor, cityData.market_anchor)
        ))
        .orderBy(
          // Core first, then Satellite, then Rural
          sql`CASE region_type
            WHEN 'Core' THEN 1
            WHEN 'Satellite' THEN 2
            WHEN 'Rural' THEN 3
            ELSE 4
          END`,
          platform_data.city
        )
        .limit(50);

      marketCities = siblings;
    }

    // Calculate deadhead risk based on region type
    const deadheadRisk = getDeadheadRisk(cityData.region_type);

    // Get market stats
    const marketStats = await db.execute(sql`
      SELECT
        COUNT(*) as total_cities,
        COUNT(*) FILTER (WHERE region_type = 'Core') as core_count,
        COUNT(*) FILTER (WHERE region_type = 'Satellite') as satellite_count,
        COUNT(*) FILTER (WHERE region_type = 'Rural') as rural_count
      FROM platform_data
      WHERE platform = 'uber' AND market_anchor = ${cityData.market_anchor}
    `);

    res.json({
      found: true,
      city: cityData.city,
      state: cityData.region,
      country: cityData.country,
      market: cityData.market,
      market_anchor: cityData.market_anchor,
      region_type: cityData.region_type,
      deadhead_risk: deadheadRisk,
      market_stats: marketStats.rows[0] || null,
      market_cities: marketCities,
      // Generate market slug from anchor
      market_slug: cityData.market_anchor
        ? cityData.market_anchor.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        : null
    });
  } catch (error) {
    console.error('Error looking up market:', error);
    res.status(500).json({ error: 'Failed to lookup market' });
  }
});

/**
 * Calculate deadhead risk based on region type
 */
function getDeadheadRisk(regionType) {
  switch (regionType) {
    case 'Core':
      return {
        level: 'low',
        score: 20,
        description: 'Core markets have high density and easy return trips.',
        advice: 'You can take rides in any direction - plenty of demand for return trips.'
      };
    case 'Satellite':
      return {
        level: 'medium',
        score: 50,
        description: 'Satellite cities have moderate density. Rides to Core are safe; rides away from Core are risky.',
        advice: 'Favor rides toward the Core city. Be cautious of rides that take you further into rural areas.'
      };
    case 'Rural':
      return {
        level: 'high',
        score: 80,
        description: 'Rural areas have low density. Every ride likely means a long deadhead return.',
        advice: 'Only take rides if the fare is worth the full round trip. Consider Long Pickup Premium settings.'
      };
    default:
      return {
        level: 'unknown',
        score: 50,
        description: 'Market data not available for this location.',
        advice: 'Check local demand patterns before accepting long rides.'
      };
  }
}

/**
 * GET /api/intelligence/market-structure/:anchor
 * Get detailed market structure for a market anchor
 */
router.get('/market-structure/:anchor', async (req, res) => {
  try {
    const { anchor } = req.params;

    // Get all cities in this market
    const cities = await db
      .select({
        city: platform_data.city,
        state: platform_data.region,
        region_type: platform_data.region_type,
        timezone: platform_data.timezone
      })
      .from(platform_data)
      .where(and(
        eq(platform_data.platform, 'uber'),
        ilike(platform_data.market_anchor, anchor)
      ))
      .orderBy(
        sql`CASE region_type
          WHEN 'Core' THEN 1
          WHEN 'Satellite' THEN 2
          WHEN 'Rural' THEN 3
          ELSE 4
        END`,
        platform_data.city
      );

    if (cities.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    // Group by region type
    const structure = {
      core: cities.filter(c => c.region_type === 'Core'),
      satellite: cities.filter(c => c.region_type === 'Satellite'),
      rural: cities.filter(c => c.region_type === 'Rural')
    };

    // Get states covered
    const states = [...new Set(cities.map(c => c.state))];

    res.json({
      market_anchor: anchor,
      total_cities: cities.length,
      states_covered: states,
      structure,
      summary: {
        core_count: structure.core.length,
        satellite_count: structure.satellite.length,
        rural_count: structure.rural.length
      }
    });
  } catch (error) {
    console.error('Error fetching market structure:', error);
    res.status(500).json({ error: 'Failed to fetch market structure' });
  }
});

/**
 * GET /api/intelligence/staging-areas
 * Get pre-computed staging areas from ranking_candidates for the tactical map
 *
 * Query params:
 *   snapshotId - The snapshot ID to fetch staging areas for (required)
 *
 * Returns staging areas with venue context for map display
 */
router.get('/staging-areas', async (req, res) => {
  try {
    const { snapshotId } = req.query;

    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    // Fetch staging areas from ranking_candidates that have staging coordinates
    const stagingAreas = await db
      .select({
        id: ranking_candidates.id,
        venueName: ranking_candidates.name,
        venueLat: ranking_candidates.lat,
        venueLng: ranking_candidates.lng,
        stagingLat: ranking_candidates.staging_lat,
        stagingLng: ranking_candidates.staging_lng,
        stagingName: ranking_candidates.staging_name,
        stagingTips: ranking_candidates.staging_tips,
        category: sql`${ranking_candidates.features}->>'category'`,
        district: ranking_candidates.district,
        proTips: ranking_candidates.pro_tips,
        valueGrade: ranking_candidates.value_grade,
        // 2026-01-09: Phase 1 schema cleanup - use canonical drive_minutes column
        driveTimeMin: ranking_candidates.drive_minutes,
        distanceMiles: ranking_candidates.distance_miles,
      })
      .from(ranking_candidates)
      .where(and(
        eq(ranking_candidates.snapshot_id, snapshotId),
        isNotNull(ranking_candidates.staging_lat),
        isNotNull(ranking_candidates.staging_lng)
      ))
      .orderBy(ranking_candidates.rank);

    // Transform to tactical map format
    const zones = stagingAreas.map(area => ({
      id: area.id,
      type: 'staging',
      name: area.stagingName || `${area.venueName} Staging`,
      lat: area.stagingLat,
      lng: area.stagingLng,
      notes: area.stagingTips || `Staging area for ${area.venueName}`,
      source: 'ranking_candidates',
      // Include venue context for reference
      venue: {
        name: area.venueName,
        lat: area.venueLat,
        lng: area.venueLng,
        category: area.category,
        district: area.district,
        valueGrade: area.valueGrade,
        driveTimeMin: area.driveTimeMin,
        distanceMiles: area.distanceMiles,
        proTips: area.proTips,
      }
    }));

    res.json({
      success: true,
      snapshotId,
      count: zones.length,
      stagingZones: zones,
    });
  } catch (error) {
    console.error('Error fetching staging areas:', error);
    res.status(500).json({ error: 'Failed to fetch staging areas' });
  }
});

// ============================================================================
// DEMAND PATTERNS API
// ============================================================================

/**
 * Default demand patterns by archetype
 * Used when no market-specific data is available
 *
 * Each archetype has hourly demand values (0-100) for each day of the week
 * Plus strategic insight and peak periods for each day
 */
const ARCHETYPE_PATTERNS = {
  sprawl: {
    name: 'Sprawl City',
    description: 'High mileage, airport-centric mornings, evening suburban sprawl',
    peakDays: ['Fri', 'Sat'],
    patterns: {
      Mon: {
        hours: [15, 30, 25, 20, 25, 55, 75, 85, 80, 65, 50, 45, 50, 55, 60, 70, 80, 85, 75, 60, 50, 40, 30, 20],
        insight: 'Monday morning airport runs dominate. Position near airport or business districts by 5 AM.',
        peakPeriods: ['5-9 AM', '4-7 PM'],
        recommendedZones: ['Airport', 'Business District', 'Medical Center'],
      },
      Tue: {
        hours: [15, 25, 20, 18, 22, 50, 70, 80, 75, 60, 48, 42, 48, 52, 58, 68, 78, 82, 72, 58, 48, 38, 28, 18],
        insight: 'Similar pattern to Monday. Medical appointments spike mid-morning.',
        peakPeriods: ['5-9 AM', '4-7 PM'],
        recommendedZones: ['Airport', 'Medical Center', 'Universities'],
      },
      Wed: {
        hours: [18, 28, 22, 20, 25, 52, 72, 82, 78, 62, 50, 45, 50, 55, 60, 70, 80, 85, 75, 62, 52, 42, 32, 22],
        insight: 'Mid-week business travel peaks. Restaurant corridors active for dinner.',
        peakPeriods: ['5-9 AM', '5-8 PM'],
        recommendedZones: ['Airport', 'Restaurant Row', 'Hotels'],
      },
      Thu: {
        hours: [20, 30, 25, 22, 28, 55, 75, 88, 82, 65, 52, 48, 55, 60, 65, 75, 85, 90, 82, 68, 58, 48, 38, 28],
        insight: 'Business travel ramps up for weekend. Restaurant and bar demand increases.',
        peakPeriods: ['5-9 AM', '5-9 PM'],
        recommendedZones: ['Airport', 'Entertainment District', 'Restaurants'],
      },
      Fri: {
        hours: [25, 35, 30, 25, 32, 58, 78, 90, 85, 68, 55, 52, 58, 65, 72, 82, 92, 95, 90, 85, 78, 68, 55, 40],
        insight: 'PEAK DAY. Airport is packed morning. Entertainment districts explode 8 PM+.',
        peakPeriods: ['5-9 AM', '7 PM-12 AM'],
        recommendedZones: ['Airport', 'Downtown', 'Entertainment District', 'Sports Venues'],
      },
      Sat: {
        hours: [35, 45, 40, 30, 25, 28, 35, 45, 55, 65, 70, 72, 70, 68, 72, 80, 88, 95, 98, 95, 88, 78, 65, 50],
        insight: 'Sleep late, work late. Brunch runs 10 AM-2 PM. Evening is the money shift.',
        peakPeriods: ['10 AM-2 PM', '6 PM-2 AM'],
        recommendedZones: ['Brunch Spots', 'Shopping Centers', 'Entertainment District', 'Sports Venues'],
      },
      Sun: {
        hours: [40, 45, 40, 30, 25, 22, 28, 35, 45, 58, 68, 72, 70, 68, 62, 55, 50, 48, 45, 40, 35, 30, 25, 20],
        insight: 'Late morning brunch, then airport runs for returning travelers. Dead by 7 PM.',
        peakPeriods: ['10 AM-3 PM', '4-7 PM'],
        recommendedZones: ['Brunch Spots', 'Airport', 'Suburbs'],
      },
    },
  },
  dense: {
    name: 'Dense Metro',
    description: 'Short trips, constant demand, transit supplements rideshare',
    peakDays: ['Thu', 'Fri', 'Sat'],
    patterns: {
      Mon: {
        hours: [20, 25, 20, 18, 25, 55, 80, 95, 90, 75, 65, 60, 65, 70, 72, 78, 85, 90, 85, 75, 65, 55, 45, 30],
        insight: 'High morning commute demand. Transit alternative positioning works well.',
        peakPeriods: ['6-10 AM', '4-8 PM'],
        recommendedZones: ['Financial District', 'Transit Hubs', 'Medical Centers'],
      },
      Tue: {
        hours: [18, 22, 18, 16, 22, 52, 78, 92, 88, 72, 62, 58, 62, 68, 70, 76, 82, 88, 82, 72, 62, 52, 42, 28],
        insight: 'Steady business day. Position near office buildings.',
        peakPeriods: ['6-10 AM', '4-8 PM'],
        recommendedZones: ['Downtown', 'Tech Campuses', 'Financial District'],
      },
      Wed: {
        hours: [20, 25, 20, 18, 24, 54, 80, 94, 90, 74, 64, 60, 64, 70, 72, 78, 84, 90, 84, 74, 64, 54, 44, 30],
        insight: 'Mid-week restaurant surge for dinner. Theater district active.',
        peakPeriods: ['6-10 AM', '5-9 PM'],
        recommendedZones: ['Downtown', 'Restaurant Row', 'Theater District'],
      },
      Thu: {
        hours: [22, 28, 22, 20, 28, 58, 82, 96, 92, 76, 66, 62, 66, 72, 75, 82, 90, 95, 92, 85, 75, 65, 52, 38],
        insight: 'Pre-weekend energy builds. Bar hopping starts early.',
        peakPeriods: ['6-10 AM', '5-11 PM'],
        recommendedZones: ['Downtown', 'Bar District', 'Sports Venues'],
      },
      Fri: {
        hours: [25, 32, 28, 24, 30, 60, 85, 98, 95, 78, 68, 65, 70, 75, 80, 88, 95, 100, 98, 95, 88, 78, 65, 48],
        insight: 'PEAK DAY. Commute + nightlife = non-stop. Position flexibility is key.',
        peakPeriods: ['6-10 AM', '6 PM-2 AM'],
        recommendedZones: ['Everywhere is busy', 'Transit Hubs', 'Entertainment Districts'],
      },
      Sat: {
        hours: [38, 48, 45, 38, 32, 30, 35, 45, 58, 72, 80, 85, 82, 78, 82, 88, 95, 100, 100, 98, 92, 82, 70, 55],
        insight: 'Brunch to bar crawl. Continuous demand with evening peak.',
        peakPeriods: ['10 AM-2 PM', '7 PM-3 AM'],
        recommendedZones: ['Brunch Districts', 'Shopping', 'Nightlife'],
      },
      Sun: {
        hours: [45, 52, 48, 40, 32, 28, 32, 40, 55, 70, 80, 85, 82, 78, 70, 62, 55, 50, 48, 45, 40, 35, 30, 25],
        insight: 'Brunch dominates morning. Airport returns in afternoon. Early dead.',
        peakPeriods: ['9 AM-3 PM'],
        recommendedZones: ['Brunch Areas', 'Airport', 'Parks'],
      },
    },
  },
  party: {
    name: 'Party/Tourism',
    description: 'Extreme peaks, dead mornings, safety paramount at night',
    peakDays: ['Fri', 'Sat', 'Sun'],
    patterns: {
      Mon: {
        hours: [30, 35, 30, 22, 18, 20, 25, 35, 45, 55, 60, 58, 55, 52, 55, 58, 62, 68, 72, 65, 55, 45, 38, 32],
        insight: 'Recovery Monday. Tourist stragglers and business conventions.',
        peakPeriods: ['9 AM-1 PM', '6-9 PM'],
        recommendedZones: ['Hotels', 'Convention Center', 'Airport'],
      },
      Tue: {
        hours: [25, 30, 25, 20, 16, 18, 22, 32, 42, 52, 58, 55, 52, 50, 52, 55, 60, 65, 68, 62, 52, 42, 35, 28],
        insight: 'Slowest day. Focus on conventions and business travelers.',
        peakPeriods: ['10 AM-2 PM', '6-9 PM'],
        recommendedZones: ['Convention Center', 'Hotels', 'Restaurants'],
      },
      Wed: {
        hours: [28, 32, 28, 22, 18, 20, 25, 35, 45, 55, 62, 60, 58, 55, 58, 62, 68, 75, 78, 72, 62, 52, 42, 35],
        insight: 'Mid-week tourists arrive. Restaurant reservations increase.',
        peakPeriods: ['10 AM-2 PM', '6-10 PM'],
        recommendedZones: ['Hotels', 'Tourist Attractions', 'Restaurants'],
      },
      Thu: {
        hours: [32, 38, 32, 25, 20, 22, 28, 38, 50, 62, 70, 68, 65, 62, 68, 75, 82, 90, 95, 88, 78, 65, 52, 42],
        insight: 'Weekend warriors arrive. Bachelor/bachelorette parties start.',
        peakPeriods: ['10 AM-2 PM', '7 PM-12 AM'],
        recommendedZones: ['Airport', 'Hotels', 'Party District'],
      },
      Fri: {
        hours: [40, 50, 45, 35, 28, 25, 30, 42, 55, 68, 78, 80, 78, 75, 80, 88, 95, 100, 100, 98, 95, 88, 75, 60],
        insight: 'PARTY STARTS. Airport arrivals all day. Night shift is where the money is.',
        peakPeriods: ['11 AM-3 PM', '8 PM-4 AM'],
        recommendedZones: ['Airport', 'Hotels', 'Strip/Main St', 'Clubs'],
      },
      Sat: {
        hours: [55, 65, 60, 50, 40, 35, 38, 48, 60, 75, 85, 88, 85, 82, 85, 92, 98, 100, 100, 100, 98, 92, 82, 68],
        insight: 'ALL DAY DEMAND. Pool parties → dinner → clubs. Stay out until 4 AM.',
        peakPeriods: ['11 AM-3 PM', '8 PM-5 AM'],
        recommendedZones: ['Pool Parties', 'Strip/Main St', 'Clubs', 'After-hours spots'],
      },
      Sun: {
        hours: [60, 70, 65, 55, 45, 38, 42, 52, 65, 78, 88, 90, 88, 82, 75, 68, 62, 58, 55, 52, 48, 42, 38, 32],
        insight: 'Brunch and recovery. Airport departures 2-7 PM. Dead by 9 PM.',
        peakPeriods: ['10 AM-3 PM', '3-7 PM'],
        recommendedZones: ['Brunch spots', 'Airport', 'Hotels'],
      },
    },
  },
};

/**
 * Detect market archetype from city name
 */
function detectArchetype(city) {
  if (!city) return 'sprawl';

  const cityLower = city.toLowerCase();

  // Dense metros
  const denseMetros = ['new york', 'manhattan', 'brooklyn', 'san francisco', 'chicago', 'boston', 'philadelphia', 'washington', 'dc'];
  if (denseMetros.some(d => cityLower.includes(d))) return 'dense';

  // Party/Tourism cities
  const partyCities = ['miami', 'las vegas', 'new orleans', 'nashville', 'austin', 'key west', 'atlantic city', 'scottsdale'];
  if (partyCities.some(p => cityLower.includes(p))) return 'party';

  // Default to sprawl
  return 'sprawl';
}

/**
 * GET /api/intelligence/demand-patterns/:marketSlug
 * Get demand patterns for a specific market
 *
 * Params:
 *   marketSlug - Market identifier (e.g., 'dallas', 'los-angeles')
 *
 * Query:
 *   city - Optional city name to detect archetype
 *
 * Returns:
 *   Hourly demand patterns by day of week with strategic insights
 *   Falls back to archetype defaults if no market-specific data exists
 */
router.get('/demand-patterns/:marketSlug', async (req, res) => {
  try {
    const { marketSlug } = req.params;
    const { city } = req.query;

    // Try to find market-specific patterns from market_intelligence
    const marketPatterns = await db
      .select({
        id: market_intelligence.id,
        title: market_intelligence.title,
        time_context: market_intelligence.time_context,
        content: market_intelligence.content,
      })
      .from(market_intelligence)
      .where(and(
        eq(market_intelligence.market_slug, marketSlug),
        eq(market_intelligence.intel_type, 'timing'),
        eq(market_intelligence.is_active, true),
      ))
      .orderBy(desc(market_intelligence.priority))
      .limit(10);

    // Detect archetype for this market
    const archetype = detectArchetype(city || marketSlug);
    const archetypeData = ARCHETYPE_PATTERNS[archetype];

    // If we have market-specific timing data, try to extract patterns
    if (marketPatterns.length > 0) {
      // Check if any pattern has structured time_context data
      const patternWithData = marketPatterns.find(p => p.time_context?.patterns);

      if (patternWithData?.time_context?.patterns) {
        // Use market-specific patterns
        return res.json({
          market: marketSlug,
          archetype,
          source: 'market_intelligence',
          archetypeInfo: {
            name: archetypeData.name,
            description: archetypeData.description,
            peakDays: archetypeData.peakDays,
          },
          patterns: patternWithData.time_context.patterns,
          insights: marketPatterns.map(p => ({
            title: p.title,
            content: p.content,
          })),
        });
      }
    }

    // Fall back to archetype defaults
    res.json({
      market: marketSlug,
      archetype,
      source: 'archetype_default',
      archetypeInfo: {
        name: archetypeData.name,
        description: archetypeData.description,
        peakDays: archetypeData.peakDays,
      },
      patterns: archetypeData.patterns,
      insights: marketPatterns.map(p => ({
        title: p.title,
        content: p.content,
      })),
    });
  } catch (error) {
    console.error('Error fetching demand patterns:', error);
    res.status(500).json({ error: 'Failed to fetch demand patterns' });
  }
});

/**
 * GET /api/intelligence/demand-patterns
 * Get demand patterns based on archetype (no market specified)
 *
 * Query:
 *   archetype - Archetype to use (sprawl, dense, party)
 */
router.get('/demand-patterns', async (req, res) => {
  try {
    const { archetype = 'sprawl' } = req.query;

    // Validate archetype
    if (!ARCHETYPE_PATTERNS[archetype]) {
      return res.status(400).json({
        error: `Invalid archetype. Must be one of: ${Object.keys(ARCHETYPE_PATTERNS).join(', ')}`,
      });
    }

    const archetypeData = ARCHETYPE_PATTERNS[archetype];

    res.json({
      market: null,
      archetype,
      source: 'archetype_default',
      archetypeInfo: {
        name: archetypeData.name,
        description: archetypeData.description,
        peakDays: archetypeData.peakDays,
      },
      patterns: archetypeData.patterns,
      insights: [],
    });
  } catch (error) {
    console.error('Error fetching demand patterns:', error);
    res.status(500).json({ error: 'Failed to fetch demand patterns' });
  }
});

export default router;
