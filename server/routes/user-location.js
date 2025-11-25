import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/drizzle.js';
import { users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;

function getDayPartKey(hour) {
  if (hour >= 0 && hour < 5) return 'overnight';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'late_morning_noon';
  if (hour >= 15 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'early_evening';
  return 'evening';
}

function pickAddressParts(components) {
  let city;
  let state;
  let country;

  for (const c of components) {
    if (c.types.includes('locality')) city = c.long_name;
    else if (c.types.includes('sublocality_level_1') && !city) city = c.long_name;
    else if (c.types.includes('administrative_area_level_1')) state = c.short_name;
    else if (c.types.includes('country')) country = c.short_name;
  }

  return { city, state, country };
}

router.post('/', async (req, res) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const started = Date.now();

  try {
    const { lat, lng, accuracy, device_id, session_id, coord_source } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ ok: false, error: 'MISSING_COORDS', req_id: reqId });
    }

    if (!device_id) {
      return res.status(400).json({ ok: false, error: 'MISSING_DEVICE_ID', req_id: reqId });
    }

    console.log(`[user-location] Resolving coords: ${lat}, ${lng}`);

    let city = null;
    let state = null;
    let country = null;
    let formattedAddress = null;
    let timezone = null;

    if (GOOGLE_MAPS_API_KEY) {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json();

      if (geocodeData.status === 'OK' && geocodeData.results?.length > 0) {
        const result = geocodeData.results[0];
        formattedAddress = result.formatted_address;
        const parts = pickAddressParts(result.address_components || []);
        city = parts.city;
        state = parts.state;
        country = parts.country;
      }

      const tzUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${Math.floor(Date.now() / 1000)}&key=${GOOGLE_MAPS_API_KEY}`;
      const tzRes = await fetch(tzUrl);
      const tzData = await tzRes.json();
      if (tzData.status === 'OK') {
        timezone = tzData.timeZoneId;
      }
    }

    const now = new Date();
    const localNow = timezone 
      ? new Date(now.toLocaleString('en-US', { timeZone: timezone }))
      : now;
    const hour = localNow.getHours();
    const dow = localNow.getDay();
    const dayPartKey = getDayPartKey(hour);

    const existingUser = await db.query.users.findFirst({
      where: eq(users.device_id, device_id),
    });

    let user_id;

    if (existingUser) {
      await db.update(users)
        .set({
          new_lat: lat,
          new_lng: lng,
          new_accuracy_m: accuracy || null,
          formatted_address: formattedAddress,
          city,
          state,
          country,
          timezone,
          local_iso: now,
          dow,
          hour,
          day_part_key: dayPartKey,
          updated_at: now,
        })
        .where(eq(users.device_id, device_id));
      
      user_id = existingUser.user_id;
      console.log(`[user-location] Updated existing user: ${user_id}`);
    } else {
      const newUser = {
        user_id: crypto.randomUUID(),
        device_id,
        session_id: session_id || null,
        lat,
        lng,
        accuracy_m: accuracy || null,
        coord_source: coord_source || 'gps',
        formatted_address: formattedAddress,
        city,
        state,
        country,
        timezone,
        local_iso: now,
        dow,
        hour,
        day_part_key: dayPartKey,
        created_at: now,
        updated_at: now,
      };

      await db.insert(users).values(newUser);
      user_id = newUser.user_id;
      console.log(`[user-location] Created new user: ${user_id}`);
    }

    console.log(`[user-location] ✅ Resolved: ${city}, ${state} (${Date.now() - started}ms)`);

    return res.json({
      ok: true,
      user_id,
      city,
      state,
      country,
      formatted_address: formattedAddress,
      timezone,
      hour,
      dow,
      day_part_key: dayPartKey,
      req_id: reqId,
    });

  } catch (err) {
    console.error('[user-location] Error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: err.message, req_id: reqId });
  }
});

router.get('/', async (req, res) => {
  const { device_id } = req.query;

  if (!device_id) {
    return res.status(400).json({ ok: false, error: 'MISSING_DEVICE_ID' });
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.device_id, device_id),
    });

    if (!user) {
      return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
    }

    return res.json({
      ok: true,
      user_id: user.user_id,
      city: user.city,
      state: user.state,
      country: user.country,
      formatted_address: user.formatted_address,
      timezone: user.timezone,
      lat: user.new_lat || user.lat,
      lng: user.new_lng || user.lng,
      hour: user.hour,
      dow: user.dow,
      day_part_key: user.day_part_key,
    });

  } catch (err) {
    console.error('[user-location] GET Error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;
