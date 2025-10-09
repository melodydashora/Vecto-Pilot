import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { user_profiles } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();

// GET /api/profile/:userId - Get user profile
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const profile = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, userId))
      .limit(1);

    if (!profile || profile.length === 0) {
      // Return default profile structure if none exists
      return res.json({
        user_id: userId,
        full_name: null,
        email: null,
        phone: null,
        preferred_city: null,
        preferred_state: null,
        rideshare_platform: null,
        target_hourly_rate: null,
        avg_trip_minutes: 15,
        avg_wait_minutes: 5,
        driver_experience_level: 'intermediate',
        preferences: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    return res.json(profile[0]);
  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// POST /api/profile - Create or update user profile
router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      full_name,
      email,
      phone,
      preferred_city,
      preferred_state,
      rideshare_platform,
      target_hourly_rate,
      avg_trip_minutes,
      avg_wait_minutes,
      driver_experience_level,
      preferences
    } = req.body;

    if (!user_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const profileData = {
      user_id,
      full_name: full_name || null,
      email: email || null,
      phone: phone || null,
      preferred_city: preferred_city || null,
      preferred_state: preferred_state || null,
      rideshare_platform: rideshare_platform || null,
      target_hourly_rate: target_hourly_rate ? Number(target_hourly_rate) : null,
      avg_trip_minutes: avg_trip_minutes ? Number(avg_trip_minutes) : 15,
      avg_wait_minutes: avg_wait_minutes ? Number(avg_wait_minutes) : 5,
      driver_experience_level: driver_experience_level || 'intermediate',
      preferences: preferences || {},
      updated_at: new Date()
    };

    // Check if profile exists
    const existing = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, user_id))
      .limit(1);

    if (existing && existing.length > 0) {
      // Update existing profile
      await db
        .update(user_profiles)
        .set(profileData)
        .where(eq(user_profiles.user_id, user_id));
      
      console.log(`✏️ Profile updated for user ${user_id}`);
    } else {
      // Create new profile
      profileData.created_at = new Date();
      await db.insert(user_profiles).values(profileData);
      
      console.log(`➕ Profile created for user ${user_id}`);
    }

    const updated = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, user_id))
      .limit(1);

    return res.json({ success: true, profile: updated[0] });
  } catch (error) {
    console.error('❌ Profile save error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

export default router;
