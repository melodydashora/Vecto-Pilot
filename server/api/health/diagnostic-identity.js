
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// Diagnostic endpoint to identify which AI system is handling requests
// SECURITY: Requires auth (reveals configuration details)
router.get('/identity', requireAuth, (req, res) => {
  const identity = {
    timestamp: new Date().toISOString(),
    
    // Check which services are running
    services: {
      gateway_port: process.env.PORT || 5000,
      agent_port: process.env.AGENT_PORT || 43717,
      eidolon_port: process.env.EIDOLON_PORT || 3101,
    },
    
    // Check which tokens are configured
    authentication: {
      eidolon_token: !!process.env.EIDOLON_TOKEN,
      agent_token: !!process.env.AGENT_TOKEN,
      ai_coach_token: !!process.env.AI_COACH_TOKEN,
    },
    
    // Check which AI models are configured
    ai_capabilities: {
      anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      openai_key: !!process.env.OPENAI_API_KEY,
      gemini_key: !!process.env.GEMINI_API_KEY,
      perplexity_key: !!process.env.PERPLEXITY_API_KEY,
    },
    
    // Check routing configuration
    routing: {
      mode: process.env.APP_MODE || 'mono',
      api_prefix: process.env.API_PREFIX || '/api',
      agent_prefix: process.env.AGENT_PREFIX || '/agent',
    },
    
    // Check override status
    overrides: {
      ai_coach_active: process.env.AI_COACH_TOKEN ? 'ENABLED' : 'DISABLED',
      agent_shell_whitelist: process.env.AGENT_SHELL_WHITELIST || 'restricted',
      disable_spawn_sdk: process.env.DISABLE_SPAWN_SDK === '1',
      disable_spawn_agent: process.env.DISABLE_SPAWN_AGENT === '1',
    },
    
    // Request context
    request_info: {
      path: req.path,
      headers: {
        user_agent: req.headers['user-agent'],
        referer: req.headers.referer,
        origin: req.headers.origin,
      },
      correlation_id: req.headers['x-correlation-id'],
    },
    
    // Determine likely active system
    likely_active_system: determineLikelySystem(process.env),
  };
  
  res.json(identity);
});

function determineLikelySystem(env) {
  const systems = [];
  
  // Check Eidolon
  if (env.EIDOLON_TOKEN && env.ANTHROPIC_API_KEY) {
    systems.push({
      name: 'Eidolon Enhanced SDK',
      confidence: 'HIGH',
      model: 'Claude Sonnet 4.5',
      capabilities: ['enhanced_memory', 'context_awareness', 'workspace_intelligence']
    });
  }
  
  // Check Agent
  if (env.AGENT_TOKEN) {
    systems.push({
      name: 'Atlas Agent',
      confidence: 'HIGH',
      capabilities: ['file_ops', 'shell_exec', 'sql_ops']
    });
  }
  
  // Check if Replit native agent might be interfering
  if (!env.AI_COACH_TOKEN) {
    systems.push({
      name: 'Replit Native Agent (possible interference)',
      confidence: 'MEDIUM',
      note: 'No AI Coach token set - Replit may be routing some requests'
    });
  }
  
  return systems;
}

export default router;
