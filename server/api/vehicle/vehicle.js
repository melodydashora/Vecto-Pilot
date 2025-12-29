// server/api/vehicle/vehicle.js
// Vehicle makes and models API (NHTSA vPIC proxy with caching)

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { eq, sql } from 'drizzle-orm';
import { vehicle_makes_cache, vehicle_models_cache } from '../../../shared/schema.js';

const router = Router();

// NHTSA vPIC API base URL
const NHTSA_API_BASE = 'https://vpic.nhtsa.dot.gov/api';

// Cache TTL: 24 hours in milliseconds
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Common makes for rideshare (prioritized in dropdown)
const COMMON_MAKES = [
  'Toyota', 'Honda', 'Nissan', 'Ford', 'Chevrolet', 'Hyundai', 'Kia',
  'Mazda', 'Subaru', 'Volkswagen', 'BMW', 'Mercedes-Benz', 'Audi',
  'Lexus', 'Acura', 'Infiniti', 'Genesis', 'Tesla', 'Chrysler', 'Dodge',
  'Jeep', 'Ram', 'GMC', 'Buick', 'Cadillac', 'Lincoln', 'Volvo',
  'Land Rover', 'Porsche', 'Jaguar', 'Mitsubishi', 'Fiat', 'Alfa Romeo',
  'Mini', 'Maserati', 'Bentley', 'Rolls-Royce', 'Aston Martin', 'Ferrari', 'Lamborghini'
];

/**
 * Check if cache is stale
 * @param {Date} cachedAt - Cache timestamp
 * @returns {boolean} True if cache is stale
 */
function isCacheStale(cachedAt) {
  if (!cachedAt) return true;
  return Date.now() - new Date(cachedAt).getTime() > CACHE_TTL_MS;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vehicle/makes - Get all vehicle makes
// ═══════════════════════════════════════════════════════════════════════════
router.get('/makes', async (req, res) => {
  try {
    // Check if we have cached makes
    const cachedMakes = await db.select().from(vehicle_makes_cache).orderBy(vehicle_makes_cache.make_name);

    // If cache exists and is fresh, return it
    if (cachedMakes.length > 0) {
      const oldestCache = cachedMakes.reduce((oldest, m) =>
        new Date(m.cached_at) < new Date(oldest.cached_at) ? m : oldest
      );

      if (!isCacheStale(oldestCache.cached_at)) {
        // Return cached makes, with common makes first
        const commonMakes = cachedMakes.filter(m => m.is_common);
        const otherMakes = cachedMakes.filter(m => !m.is_common);

        return res.json({
          makes: [...commonMakes, ...otherMakes].map(m => ({
            id: m.make_id,
            name: m.make_name,
            isCommon: m.is_common
          })),
          cached: true,
          cachedAt: oldestCache.cached_at
        });
      }
    }

    // Fetch from NHTSA API
    console.log('[vehicle] Fetching makes from NHTSA API...');
    const response = await fetch(`${NHTSA_API_BASE}/vehicles/GetAllMakes?format=json`);

    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.Results || [];

    // Filter to passenger vehicle makes (skip motorcycles, trailers, etc.)
    // Most rideshare-relevant makes have IDs under 10000
    const makes = results
      .filter(m => m.Make_ID && m.Make_Name)
      .map(m => ({
        make_id: m.Make_ID,
        make_name: m.Make_Name.trim(),
        is_common: COMMON_MAKES.some(cm =>
          m.Make_Name.toLowerCase().includes(cm.toLowerCase())
        ),
        cached_at: new Date()
      }))
      .sort((a, b) => a.make_name.localeCompare(b.make_name));

    // Clear old cache and insert new
    await db.delete(vehicle_makes_cache);
    if (makes.length > 0) {
      await db.insert(vehicle_makes_cache).values(makes);
    }

    console.log(`[vehicle] Cached ${makes.length} makes from NHTSA`);

    // Return with common makes first
    const commonMakes = makes.filter(m => m.is_common);
    const otherMakes = makes.filter(m => !m.is_common);

    res.json({
      makes: [...commonMakes, ...otherMakes].map(m => ({
        id: m.make_id,
        name: m.make_name,
        isCommon: m.is_common
      })),
      cached: false,
      totalCount: makes.length
    });

  } catch (err) {
    console.error('[vehicle] Failed to fetch makes:', err.message);

    // Fall back to cached data if available
    const cachedMakes = await db.select().from(vehicle_makes_cache).orderBy(vehicle_makes_cache.make_name);
    if (cachedMakes.length > 0) {
      return res.json({
        makes: cachedMakes.map(m => ({
          id: m.make_id,
          name: m.make_name,
          isCommon: m.is_common
        })),
        cached: true,
        fallback: true
      });
    }

    res.status(500).json({ error: 'FETCH_MAKES_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vehicle/models - Get models for a make and year
// ═══════════════════════════════════════════════════════════════════════════
router.get('/models', async (req, res) => {
  try {
    const { make, year } = req.query;

    if (!make) {
      return res.status(400).json({
        error: 'MISSING_MAKE',
        message: 'Make is required'
      });
    }

    // Default to current year if not provided
    const modelYear = year ? parseInt(year, 10) : new Date().getFullYear();

    // Check cache first
    const cachedModels = await db.select()
      .from(vehicle_models_cache)
      .where(sql`LOWER(${vehicle_models_cache.make_name}) = LOWER(${make}) AND ${vehicle_models_cache.model_year} = ${modelYear}`);

    if (cachedModels.length > 0 && !isCacheStale(cachedModels[0].cached_at)) {
      return res.json({
        models: cachedModels.map(m => ({
          id: m.model_id,
          name: m.model_name
        })),
        make,
        year: modelYear,
        cached: true
      });
    }

    // Fetch from NHTSA API
    console.log(`[vehicle] Fetching models for ${make} ${modelYear} from NHTSA API...`);
    const response = await fetch(
      `${NHTSA_API_BASE}/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${modelYear}?format=json`
    );

    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.Results || [];

    // Extract models
    const models = results
      .filter(m => m.Model_ID && m.Model_Name)
      .map(m => ({
        model_id: m.Model_ID,
        model_name: m.Model_Name.trim(),
        make_id: m.Make_ID || 0,
        make_name: make,
        model_year: modelYear,
        cached_at: new Date()
      }))
      .sort((a, b) => a.model_name.localeCompare(b.model_name));

    // Clear old cache for this make/year and insert new
    await db.delete(vehicle_models_cache)
      .where(sql`LOWER(${vehicle_models_cache.make_name}) = LOWER(${make}) AND ${vehicle_models_cache.model_year} = ${modelYear}`);

    if (models.length > 0) {
      await db.insert(vehicle_models_cache).values(models);
    }

    console.log(`[vehicle] Cached ${models.length} models for ${make} ${modelYear}`);

    res.json({
      models: models.map(m => ({
        id: m.model_id,
        name: m.model_name
      })),
      make,
      year: modelYear,
      cached: false,
      totalCount: models.length
    });

  } catch (err) {
    console.error('[vehicle] Failed to fetch models:', err.message);

    // Fall back to cached data
    const { make, year } = req.query;
    const modelYear = year ? parseInt(year, 10) : new Date().getFullYear();

    const cachedModels = await db.select()
      .from(vehicle_models_cache)
      .where(sql`LOWER(${vehicle_models_cache.make_name}) = LOWER(${make}) AND ${vehicle_models_cache.model_year} = ${modelYear}`);

    if (cachedModels.length > 0) {
      return res.json({
        models: cachedModels.map(m => ({
          id: m.model_id,
          name: m.model_name
        })),
        make,
        year: modelYear,
        cached: true,
        fallback: true
      });
    }

    res.status(500).json({ error: 'FETCH_MODELS_FAILED', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/vehicle/years - Get available vehicle years
// ═══════════════════════════════════════════════════════════════════════════
router.get('/years', (req, res) => {
  const currentYear = new Date().getFullYear();
  const startYear = 2005; // Oldest rideshare-eligible vehicles

  const years = [];
  for (let year = currentYear + 1; year >= startYear; year--) {
    years.push(year);
  }

  res.json({ years });
});

export default router;
