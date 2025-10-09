import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { user_preferences } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();

// GET /api/preferences/:userId - Get user preferences
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const prefs = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, userId))
      .limit(1);

    if (!prefs || prefs.length === 0) {
      // Return default preferences structure if none exists
      return res.json({
        user_id: userId,
        driver_first_name: null,
        driver_last_name: null,
        driver_preferred_name: null,
        driver_home_address: null,
        driver_city: null,
        driver_state: null,
        driver_assigned_region: null,
        car_year: null,
        car_make: null,
        car_model: null,
        car_color: null,
        seatbelt_count: null,
        service_uber: false,
        service_lyft: false,
        service_private: false,
        service_ridehail: false,
        service_other: false,
        service_other_explanation: null,
        tier_1_all_rides: false,
        tier_2_comfort: false,
        tier_3_7passenger: false,
        tier_4_7pass_comfort: false,
        tier_5_7pass_xxl: false,
        planet_friendly: false,
        tier_other: false,
        tier_other_explanation: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    return res.json(prefs[0]);
  } catch (error) {
    console.error('❌ Preferences fetch error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// POST /api/preferences - Create or update user preferences
router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      driver_first_name,
      driver_last_name,
      driver_preferred_name,
      driver_home_address,
      driver_city,
      driver_state,
      driver_assigned_region,
      car_year,
      car_make,
      car_model,
      car_color,
      seatbelt_count,
      service_uber,
      service_lyft,
      service_private,
      service_ridehail,
      service_other,
      service_other_explanation,
      tier_1_all_rides,
      tier_2_comfort,
      tier_3_7passenger,
      tier_4_7pass_comfort,
      tier_5_7pass_xxl,
      planet_friendly,
      tier_other,
      tier_other_explanation
    } = req.body;

    if (!user_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const prefsData = {
      user_id,
      driver_first_name: driver_first_name || null,
      driver_last_name: driver_last_name || null,
      driver_preferred_name: driver_preferred_name || null,
      driver_home_address: driver_home_address || null,
      driver_city: driver_city || null,
      driver_state: driver_state || null,
      driver_assigned_region: driver_assigned_region || null,
      car_year: car_year || null,
      car_make: car_make || null,
      car_model: car_model || null,
      car_color: car_color || null,
      seatbelt_count: seatbelt_count || null,
      service_uber: service_uber || false,
      service_lyft: service_lyft || false,
      service_private: service_private || false,
      service_ridehail: service_ridehail || false,
      service_other: service_other || false,
      service_other_explanation: service_other_explanation || null,
      tier_1_all_rides: tier_1_all_rides || false,
      tier_2_comfort: tier_2_comfort || false,
      tier_3_7passenger: tier_3_7passenger || false,
      tier_4_7pass_comfort: tier_4_7pass_comfort || false,
      tier_5_7pass_xxl: tier_5_7pass_xxl || false,
      planet_friendly: planet_friendly || false,
      tier_other: tier_other || false,
      tier_other_explanation: tier_other_explanation || null,
      updated_at: new Date()
    };

    // Check if preferences exist
    const existing = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, user_id))
      .limit(1);

    let result;
    if (existing && existing.length > 0) {
      // Update existing preferences
      result = await db
        .update(user_preferences)
        .set(prefsData)
        .where(eq(user_preferences.user_id, user_id))
        .returning();
    } else {
      // Insert new preferences
      result = await db
        .insert(user_preferences)
        .values(prefsData)
        .returning();
    }

    return res.json(result[0]);
  } catch (error) {
    console.error('❌ Preferences save error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

export default router;
