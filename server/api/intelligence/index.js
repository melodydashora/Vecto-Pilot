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
 *   GET /api/intelligence/market/:slug       - Get intelligence for a specific market
 *   GET /api/intelligence/:id                - Get a specific intelligence item
 *   POST /api/intelligence                   - Create new intelligence (admin/coach)
 *   PUT /api/intelligence/:id                - Update intelligence item
 *   GET /api/intelligence/coach/:market      - Get AI Coach context for a market
 */

import express from 'express';
import { db } from '../../db/drizzle.js';
import { market_intelligence, platform_data } from '../../../shared/schema.js';
import { eq, and, or, ilike, sql, desc, asc } from 'drizzle-orm';

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

export default router;
