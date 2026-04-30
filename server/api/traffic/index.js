// server/api/traffic/index.js
//
// 2026-04-29: Plan G — discovered_traffic read API.
// GET /api/traffic/incidents?snapshot_id=<uuid>
//
// Returns the cached TomTom incidents for a given snapshot. Decouples the
// strategy map's incident layer from briefing assembly: the map can now read
// incidents directly without depending on Gemini consolidation succeeding.
//
// Companion to:
//   - migrations/20260429_discovered_traffic.sql (table DDL)
//   - shared/schema.js (Drizzle table)
//   - server-side write path in briefing-service.js (Plan G write)
//   - client/src/hooks/useTrafficIncidents.ts (consumer)

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { discovered_traffic } from '../../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// All routes here require authentication — incident data is per-snapshot and
// scoped to a device. We return data only for the specific snapshot the client
// requests; the caller is responsible for owning that snapshot.
router.use(requireAuth);

/**
 * GET /api/traffic/incidents
 *
 * Query: snapshot_id (uuid, required)
 *
 * Response: {
 *   success: true,
 *   incidents: PlottableTrafficIncident[],
 *   snapshot_id: string,
 *   count: number,
 *   fetched_at: string | null   // ISO timestamp of most recent insert for this snapshot
 * }
 *
 * Empty array (count: 0) is a valid success response — means TomTom hasn't yet
 * written rows for this snapshot, OR there are no incidents in the radius, OR
 * TOMTOM_API_KEY is unset on the server.
 */
router.get('/incidents', async (req, res) => {
  const { snapshot_id } = req.query;

  if (!snapshot_id || typeof snapshot_id !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing required query parameter: snapshot_id (uuid)',
    });
  }

  // Basic uuid shape check — DB will also reject malformed uuids
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshot_id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid snapshot_id format',
    });
  }

  try {
    const rows = await db
      .select()
      .from(discovered_traffic)
      .where(eq(discovered_traffic.snapshot_id, snapshot_id))
      .orderBy(desc(discovered_traffic.fetched_at));

    // Shape rows for client consumption — match the PlottableTrafficIncident
    // contract from useTrafficIncidents.ts so the hook can consume directly.
    const incidents = rows.map((r) => ({
      description: r.description ?? '',
      severity: r.severity, // 'high' | 'medium' | 'low'
      category: r.category,
      road: r.road ?? '',
      location: r.location ?? '',
      isHighway: r.is_highway,
      priority: 0, // not currently persisted; reserved for future
      delayMinutes: r.delay_minutes ?? 0,
      lengthMiles: r.length_miles,
      distanceFromDriver: r.distance_miles,
      incidentLat: r.lat,
      incidentLon: r.lng,
    }));

    res.json({
      success: true,
      incidents,
      snapshot_id,
      count: incidents.length,
      fetched_at: rows.length > 0 ? rows[0].fetched_at : null,
    });
  } catch (err) {
    console.error('[traffic-api] GET /incidents failed:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
});

export default router;
