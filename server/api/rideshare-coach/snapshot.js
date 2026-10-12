import { Router } from 'express';
import { captureCoachSnapshot, readOwnedCoachSnapshot } from '../../lib/location/coach-snapshot.js';
import { snapshotResponse, sendSnapshotError } from '../../lib/location/main-run-snapshot.js';

const router = Router();
const receipt = snapshot => ({ ...snapshotResponse(snapshot), context_kind: 'coach', market: snapshot.market,
  gps_timestamp: snapshot.permissions.gps_timestamp ?? Date.parse(snapshot.permissions.observed_at) });

// Mounted below the Coach router's authenticated owner/session boundary.
router.get('/', async (req, res) => {
  try {
    const snapshot = await readOwnedCoachSnapshot(req.auth);
    return res.json(snapshot ? receipt(snapshot) : { ok: true, snapshot: null });
  } catch (error) { return sendSnapshotError(res, error); }
});
router.post('/', async (req, res) => {
  try {
    const snapshot = await captureCoachSnapshot(req.auth, req.body?.captureId, req.body);
    return res.status(201).json(receipt(snapshot));
  } catch (error) { return sendSnapshotError(res, error); }
});
export default router;
