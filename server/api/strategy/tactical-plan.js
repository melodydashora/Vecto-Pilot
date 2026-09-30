import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// The only UI consumer was removed from RideshareIntelTab in April 2026.
// This legacy generator trusted model coordinates and manufactured geometric
// staging/avoid zones when parsing failed. Neither establishes safe waiting or
// pickup access. Keep an explicit retirement response for old clients; the MAIN
// venue pipeline verifies Places identities, routes and saved source ownership.
// Recovery/provenance: docs/architecture/removals/2026-09-29-pipeline-review.md.
router.post('/', requireAuth, (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'tactical_plan_retired',
    message: 'This tactical map is no longer available. Use your current Strategy recommendations.',
    stagingZones: [],
    avoidZones: [],
  });
});

export default router;
