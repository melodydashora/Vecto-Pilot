// server/api/location/snapshot.js
import express, { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { normalizeDayPartKey } from '../../lib/location/daypart.js';
import { requireAuth } from '../../middleware/auth.js';
import { getSnapshotReadiness } from '../../lib/location/snapshot-readiness.js';
import { portalSnapshotHandler } from '../../lib/location/main-run-snapshot.js';
import { getLocalIso } from '../../../shared/dayparts.js';

const router = Router();

router.use(express.json({ limit: "1mb", strict: true }));

// The legacy writer uses the same fresh collector and run admission as location/resolve.
router.post('/', requireAuth, portalSnapshotHandler);

// GET /:snapshotId - Fetch snapshot for Coach context (early engagement backup)
// Snapshot fields: city, state, weather (temp, condition), air (AQI), hour, dayPart, holiday, timezone, coordinates
// SECURITY: requireAuth enforces user must be signed in (GPS gating requires auth)
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';

router.get("/:snapshotId", requireAuth, requireSnapshotOwnership, async (req, res) => {
  const { snapshotId } = req.params;
  
  if (!snapshotId) {
    return res.status(400).json({ ok: false, error: 'MISSING_SNAPSHOT_ID' });
  }
  
  try {
    const snapshot = await db.query.snapshots.findFirst({
      where: (t) => sql`${t.snapshot_id} = ${snapshotId}`,
    });
    
    if (!snapshot) {
      return res.status(404).json({ ok: false, error: 'SNAPSHOT_NOT_FOUND' });
    }
    
    // 2026-04-28: snapshot-fetch debug dump demoted; chain + snapshot ID
    // already locate the row, and this fired on every GET (noisy).
    if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
      console.log('[SNAPSHOT] GET fetched:', {
        snapshot_id: snapshot.snapshot_id, city: snapshot.city,
        weather: !!snapshot.weather, aqi: snapshot.air?.aqi ?? null,
        dayPart: snapshot.day_part_key
      });
    }
    
    // Return all snapshot fields for Coach context
    const readiness = getSnapshotReadiness(snapshot, snapshotId);
    // 2026-04-18: Include `status` so the client-side briefing readiness gate
    // (`useBriefingQueries` isEnabled check on snapshotStatus === 'ok') actually
    // works. Before today this field was silently omitted, which made the gate
    // permanently closed for every real (UUID) snapshot and froze the briefing
    // tab spinner forever. Root cause of the "briefing tab spins after login"
    // symptom per the UI audit on 2026-04-18.
    return res.json({
      snapshot_id: snapshot.snapshot_id,
      status: readiness.ready ? 'ok' : snapshot.status === 'ok' ? 'pending' : readiness.status,
      missing_fields: readiness.missingFields,
      city: snapshot.city,
      state: snapshot.state,
      country: snapshot.country,
      formatted_address: snapshot.formatted_address,
      timezone: snapshot.timezone,
      lat: snapshot.lat,
      lng: snapshot.lng,
      hour: snapshot.hour,
      dow: snapshot.dow,
      // 2026-07-06: normalize legacy keys on read (pre-rename rows); null only
      // if the stored value is corrupt, which the client treats as absent
      day_part_key: normalizeDayPartKey(snapshot.day_part_key),
      weather: snapshot.weather,
      air: snapshot.air,
      // 2026-01-14: airport_context dropped - now in briefings.airport_conditions
      // 2026-07-06: holiday dropped - now in briefings.holiday (aggregate endpoint)
      h3_r8: snapshot.h3_r8,
      created_at: snapshot.created_at?.toISOString(),
      local_iso: getLocalIso(new Date(snapshot.created_at), snapshot.timezone),
    });
  } catch (err) {
    console.error('[SNAPSHOT] Error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: String(err) });
  }
});

// Retire destructive refresh while preserving the URL for older clients.
router.post('/drop', requireAuth, (_req, res) => res.status(409).json({
  ok: false, error: 'explicit_continue_required',
  message: 'Snapshot history is preserved. Review setup and choose Continue with saved preferences.',
}));

export default router;
