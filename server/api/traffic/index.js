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
import { discovered_traffic, snapshots, main_run_admissions } from '../../../shared/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';
import { verifySnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';

const router = Router();

// All routes here require authentication — incident data is per-snapshot and
// scoped to the authenticated owner. A Strategy consumption reads its verified
// original observation; historical reads do not need the current GPS pointer.
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
    const owned = await verifySnapshotOwnership(snapshot_id, req.auth.userId);
    if (!owned.ok) return res.status(owned.status).json({ success: false, ...owned.body });
    const requested = owned.snapshot;
    let sourceId = snapshot_id;
    if (requested.permissions?.context_kind === 'strategy_context') {
      sourceId = requested.permissions.context_source_snapshot_id;
      const generation = requested.permissions.context_source_generation_token;
      if (typeof sourceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) {
        return res.status(409).json({ success: false, error: 'traffic_source_unverified' });
      }
      const [admission] = await db.select().from(main_run_admissions).where(and(
        eq(main_run_admissions.snapshot_id, snapshot_id), eq(main_run_admissions.user_id, req.auth.userId),
        eq(main_run_admissions.session_id, requested.session_id),
      )).limit(1);
      if (!generation || admission?.configuration?.context_source?.snapshot_id !== sourceId ||
          admission.configuration.context_source.briefing_generation_token !== generation) {
        return res.status(409).json({ success: false, error: 'traffic_source_unverified' });
      }
      const [source] = await db.select().from(snapshots).where(and(
        eq(snapshots.snapshot_id, sourceId), eq(snapshots.user_id, req.auth.userId),
        eq(snapshots.session_id, requested.session_id),
      )).limit(1);
      if (!source || source.lat !== requested.lat || source.lng !== requested.lng ||
          new Date(source.created_at).getTime() !== new Date(requested.created_at).getTime()) {
        return res.status(409).json({ success: false, error: 'traffic_source_unverified' });
      }
    }
    const rows = await db
      .select()
      .from(discovered_traffic)
      .where(eq(discovered_traffic.snapshot_id, sourceId))
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
      source_snapshot_id: sourceId,
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
