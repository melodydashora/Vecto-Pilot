
import { unifiedAI } from '../lib/unified-ai-capabilities.js';

export default function unifiedCapabilitiesRoutes(app) {
  // Get all unified capabilities
  app.get('/api/unified/capabilities', async (req, res) => {
    try {
      const capabilities = unifiedAI.getCapabilities();
      res.json({
        ok: true,
        capabilities,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  });
  
  // Get health status
  app.get('/api/unified/health', async (req, res) => {
    try {
      const health = await unifiedAI.checkHealth();
      res.json({
        ok: true,
        health,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  });
  
  // Trigger manual healing
  app.post('/api/unified/heal', async (req, res) => {
    try {
      await unifiedAI.autoHeal();
      const health = await unifiedAI.checkHealth();
      res.json({
        ok: true,
        message: 'Self-healing completed',
        health,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  });
}
