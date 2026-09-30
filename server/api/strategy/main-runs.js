import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { continueMainRun, getMainRunSetup, MainRunAdmissionError } from '../../lib/main-run-admission.js';

const router = Router();
router.use(requireAuth);
function failed(res, error) {
  if (error instanceof MainRunAdmissionError) {
    return res.status(error.status).json({ error: error.code, message: error.message, ...error.details });
  }
  console.error('[MAIN_RUN] Setup operation failed:', error.message);
  return res.status(503).json({ error: 'setup_unavailable', message: 'Saved setup could not be verified. Retry before continuing.' });
}
router.get('/setup', async (req, res) => {
  try { return res.json(await getMainRunSetup(req.auth)); }
  catch (error) { return failed(res, error); }
});
router.post('/continue', async (req, res) => {
  try {
    const result = await continueMainRun(req.auth, req.body);
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { return failed(res, error); }
});
export default router;
