import { Router } from 'express';
import crypto from 'crypto';
import { authLog, OP } from '../../logger/workflow.js';

const router = Router();

// POST /api/auth/token - Generate JWT token for user
router.post('/token', async (req, res) => {
  try {
    const { user_id } = req.body || req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }

    // Generate signed token: userId.signature
    const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID || 'dev-secret-change-in-production';
    const signature = crypto.createHmac('sha256', secret).update(user_id).digest('hex');
    const token = `${user_id}.${signature}`;

    authLog.done(1, `Generated token for user: ${user_id.substring(0, 20)}`);
    
    res.json({ 
      token,
      user_id,
      expires_in: 86400 // 24 hours
    });
  } catch (err) {
    authLog.error(1, `Token generation failed`, err);
    res.status(500).json({ error: 'Token generation failed', detail: err.message });
  }
});

export default router;
