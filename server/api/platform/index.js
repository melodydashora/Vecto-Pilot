/**
 * Platform Data API
 *
 * Provides access to rideshare platform coverage data including:
 * - Cities/markets where platforms operate
 * - Market boundaries and timezones
 * - Platform-specific information
 *
 * Routes:
 *   GET /api/platform/markets          - List all markets with city counts
 *   GET /api/platform/markets/:market  - Get cities in a specific market
 *   GET /api/platform/countries        - List all countries with city counts
 *   GET /api/platform/search           - Search cities by name
 *   GET /api/platform/city/:city       - Get details for a specific city
 */

import express from 'express';
import { db } from '../../db/drizzle.js';
import { platform_data } from '../../../shared/schema.js';
import { eq, sql, ilike, and, or, desc, asc } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/platform/markets
 * List all markets with city counts
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 *   country  - Filter by country
 */
router.get('/markets', async (req, res) => {
  try {
    const { platform = 'uber', country } = req.query;

    let baseQuery = sql`
      SELECT
        COALESCE(market, 'Unassigned') as market,
        country,
        COUNT(*) as city_count,
        MIN(timezone) as timezone
      FROM platform_data
      WHERE platform = ${platform}
    `;

    if (country) {
      baseQuery = sql`${baseQuery} AND country = ${country}`;
    }

    baseQuery = sql`${baseQuery}
      GROUP BY market, country
      ORDER BY city_count DESC, market
    `;

    const result = await db.execute(baseQuery);

    res.json({
      platform,
      total_markets: result.rows.filter(r => r.market !== 'Unassigned').length,
      markets: result.rows
    });
  } catch (error) {
    console.error('Error fetching markets:', error);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

/**
 * GET /api/platform/markets/:market
 * Get all cities in a specific market
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 */
router.get('/markets/:market', async (req, res) => {
  try {
    const { market } = req.params;
    const { platform = 'uber' } = req.query;

    const cities = await db
      .select({
        city: platform_data.city,
        region: platform_data.region,
        country: platform_data.country,
        country_code: platform_data.country_code,
        timezone: platform_data.timezone,
        center_lat: platform_data.center_lat,
        center_lng: platform_data.center_lng,
        is_active: platform_data.is_active
      })
      .from(platform_data)
      .where(
        and(
          eq(platform_data.platform, platform),
          eq(platform_data.market, market)
        )
      )
      .orderBy(asc(platform_data.city));

    if (cities.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    res.json({
      market,
      platform,
      city_count: cities.length,
      timezone: cities[0]?.timezone,
      cities
    });
  } catch (error) {
    console.error('Error fetching market cities:', error);
    res.status(500).json({ error: 'Failed to fetch market cities' });
  }
});

/**
 * GET /api/platform/countries
 * List all countries with city counts
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 */
router.get('/countries', async (req, res) => {
  try {
    const { platform = 'uber' } = req.query;

    const result = await db.execute(sql`
      SELECT
        country,
        country_code,
        COUNT(*) as city_count,
        COUNT(DISTINCT market) FILTER (WHERE market IS NOT NULL) as market_count,
        COUNT(*) FILTER (WHERE timezone IS NOT NULL) as cities_with_timezone
      FROM platform_data
      WHERE platform = ${platform}
      GROUP BY country, country_code
      ORDER BY city_count DESC
    `);

    res.json({
      platform,
      total_countries: result.rows.length,
      countries: result.rows
    });
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

/**
 * GET /api/platform/search
 * Search cities by name
 *
 * Query params:
 *   q        - Search query (required)
 *   platform - Filter by platform (default: uber)
 *   country  - Filter by country
 *   limit    - Max results (default: 20, max: 100)
 */
router.get('/search', async (req, res) => {
  try {
    const { q, platform = 'uber', country, limit = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchLimit = Math.min(parseInt(limit) || 20, 100);
    const searchPattern = `%${q}%`;

    let conditions = [
      eq(platform_data.platform, platform),
      ilike(platform_data.city, searchPattern)
    ];

    if (country) {
      conditions.push(eq(platform_data.country, country));
    }

    const cities = await db
      .select({
        city: platform_data.city,
        region: platform_data.region,
        country: platform_data.country,
        country_code: platform_data.country_code,
        market: platform_data.market,
        timezone: platform_data.timezone,
        center_lat: platform_data.center_lat,
        center_lng: platform_data.center_lng
      })
      .from(platform_data)
      .where(and(...conditions))
      .orderBy(
        // Prioritize exact matches, then by city name
        sql`CASE WHEN LOWER(city) = LOWER(${q}) THEN 0 ELSE 1 END`,
        asc(platform_data.city)
      )
      .limit(searchLimit);

    res.json({
      query: q,
      platform,
      result_count: cities.length,
      cities
    });
  } catch (error) {
    console.error('Error searching cities:', error);
    res.status(500).json({ error: 'Failed to search cities' });
  }
});

/**
 * GET /api/platform/city/:city
 * Get details for a specific city
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 *   region   - Filter by region/state
 *   country  - Filter by country
 */
router.get('/city/:city', async (req, res) => {
  try {
    const { city } = req.params;
    const { platform = 'uber', region, country } = req.query;

    let conditions = [
      eq(platform_data.platform, platform),
      ilike(platform_data.city, city)
    ];

    if (region) {
      conditions.push(eq(platform_data.region, region));
    }
    if (country) {
      conditions.push(eq(platform_data.country, country));
    }

    const cities = await db
      .select()
      .from(platform_data)
      .where(and(...conditions));

    if (cities.length === 0) {
      return res.status(404).json({ error: 'City not found' });
    }

    // If multiple matches, return all
    if (cities.length > 1) {
      return res.json({
        message: 'Multiple cities found, specify region or country',
        count: cities.length,
        cities
      });
    }

    res.json(cities[0]);
  } catch (error) {
    console.error('Error fetching city:', error);
    res.status(500).json({ error: 'Failed to fetch city' });
  }
});

/**
 * GET /api/platform/stats
 * Get overall platform statistics
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 */
router.get('/stats', async (req, res) => {
  try {
    const { platform = 'uber' } = req.query;

    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total_cities,
        COUNT(DISTINCT country) as total_countries,
        COUNT(DISTINCT market) FILTER (WHERE market IS NOT NULL) as total_markets,
        COUNT(*) FILTER (WHERE timezone IS NOT NULL) as cities_with_timezone,
        COUNT(*) FILTER (WHERE market IS NOT NULL) as cities_with_market,
        COUNT(*) FILTER (WHERE coord_boundary IS NOT NULL) as cities_with_boundary
      FROM platform_data
      WHERE platform = ${platform}
    `);

    const topCountries = await db.execute(sql`
      SELECT country, COUNT(*) as city_count
      FROM platform_data
      WHERE platform = ${platform}
      GROUP BY country
      ORDER BY city_count DESC
      LIMIT 10
    `);

    const topMarkets = await db.execute(sql`
      SELECT market, COUNT(*) as city_count
      FROM platform_data
      WHERE platform = ${platform} AND market IS NOT NULL
      GROUP BY market
      ORDER BY city_count DESC
      LIMIT 10
    `);

    res.json({
      platform,
      stats: result.rows[0],
      top_countries: topCountries.rows,
      top_markets: topMarkets.rows
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/platform/countries-dropdown
 * Get countries for signup dropdown (simple value/label format)
 * Uses the countries reference table (ISO 3166-1 standard)
 * Returns priority countries first (US, CA, etc.), then alphabetically
 *
 * Query params:
 *   all - If 'true', include all countries. Otherwise only show countries with platform data
 */
router.get('/countries-dropdown', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';

    // Query from countries reference table
    // Priority countries (display_order < 100) come first, then alphabetical
    const result = await db.execute(sql`
      SELECT code, name, has_platform_data
      FROM countries
      WHERE is_active = true
      ORDER BY display_order, name
    `);

    // Format as value/label pairs for dropdown
    // If not showing all, filter to only countries with platform data
    const countries = result.rows
      .filter(r => showAll || r.has_platform_data)
      .map(r => ({
        value: r.code,
        label: r.name,
        hasPlatformData: r.has_platform_data
      }));

    // Add "Other" option at the end for countries not in the list
    countries.push({
      value: 'OTHER',
      label: 'Other (Country not listed)',
      hasPlatformData: false
    });

    res.json({
      countries,
      totalAvailable: result.rows.length,
      showingAll: showAll
    });
  } catch (error) {
    console.error('Error fetching countries dropdown:', error);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

/**
 * GET /api/platform/regions-dropdown
 * Get regions/states for signup dropdown based on country
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 *   country  - Country name or code (required)
 */
router.get('/regions-dropdown', async (req, res) => {
  try {
    const { platform = 'uber', country } = req.query;

    if (!country) {
      return res.status(400).json({ error: 'Country is required' });
    }

    const result = await db.execute(sql`
      SELECT DISTINCT region
      FROM platform_data
      WHERE platform = ${platform}
        AND (country = ${country} OR country_code = ${country})
        AND region IS NOT NULL
      ORDER BY region
    `);

    // Format as value/label pairs for dropdown
    const regions = result.rows
      .filter(r => r.region)
      .map(r => ({
        value: r.region,
        label: r.region
      }));

    res.json({ regions });
  } catch (error) {
    console.error('Error fetching regions dropdown:', error);
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

/**
 * GET /api/platform/markets-dropdown
 * Get markets for signup dropdown (simple value/label format)
 *
 * Query params:
 *   platform - Filter by platform (default: uber)
 *   country  - Filter by country (default: United States)
 */
router.get('/markets-dropdown', async (req, res) => {
  try {
    const { platform = 'uber', country = 'United States' } = req.query;

    const result = await db.execute(sql`
      SELECT DISTINCT market
      FROM platform_data
      WHERE platform = ${platform}
        AND (country = ${country} OR country_code = ${country})
        AND market IS NOT NULL
      ORDER BY market
    `);

    // Format as value/label pairs for dropdown
    const markets = result.rows
      .filter(r => r.market)
      .map(r => ({
        value: r.market.toLowerCase().replace(/\s+/g, '-'),
        label: r.market
      }));

    res.json({ markets });
  } catch (error) {
    console.error('Error fetching markets dropdown:', error);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

export default router;
