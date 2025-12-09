import Anthropic from "@anthropic-ai/sdk";

// UNIFIED CONFIGURATION - Claude Opus 4.5 (Agent/Assistant/Eidolon)
const AGENT_OVERRIDE_ORDER = ["anthropic"]; // Single provider

const CLAUDE_KEY = process.env.AGENT_OVERRIDE_API_KEY_C || process.env.ANTHROPIC_API_KEY;

// Claude Opus 4.5 - unified across all AI systems
const CLAUDE_MODEL = process.env.AGENT_OVERRIDE_CLAUDE_MODEL || process.env.AGENT_MODEL || "claude-opus-4-5-20251101";

// Match Eidolon's ULTRA-ENHANCED parameters
const CLAUDE_MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || process.env.AGENT_MAX_TOKENS || "200000", 10);
const CLAUDE_TEMPERATURE = parseFloat(process.env.CLAUDE_TEMPERATURE || process.env.AGENT_TEMPERATURE || "1.0");
const GPT5_REASONING_EFFORT = process.env.GPT5_REASONING_EFFORT || "high";
const GPT5_MAX_TOKENS = parseInt(process.env.GPT5_MAX_TOKENS || "128000", 10);
const GEMINI_TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || "1.0");
const GEMINI_MAX_TOKENS = parseInt(process.env.GEMINI_MAX_TOKENS || "32768", 10);

async function callClaude({ system, user, json }) {
  if (!CLAUDE_KEY) throw new Error("AGENT_OVERRIDE_API_KEY_C or ANTHROPIC_API_KEY not configured");
  
  const anthropic = new Anthropic({ apiKey: CLAUDE_KEY });
  const start = Date.now();
  
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    temperature: CLAUDE_TEMPERATURE,
    system,
    messages: [{ role: "user", content: user }],
  };

  console.log(`[Atlas/Claude] Using ${CLAUDE_MODEL} with ${CLAUDE_MAX_TOKENS} max tokens, temp=${CLAUDE_TEMPERATURE}`);
  
  const completion = await anthropic.messages.create(params);
  
  return {
    provider: "anthropic",
    model: CLAUDE_MODEL,
    text: completion.content[0].text,
    elapsed_ms: Date.now() - start,
    usage: completion.usage,
  };
}

// EIDOLON-MATCHING: Only Claude provider (no fallbacks)
const PROVIDERS = {
  anthropic: callClaude
};

// Self-healing state tracker
const healingState = {
  consecutiveFailures: 0,
  lastSuccessTime: Date.now(),
  circuitBreakerOpen: false,
  recoveryAttempts: 0
};

export async function agentAsk({ system, user, json = false }) {
  // Self-healing: Check circuit breaker
  if (healingState.circuitBreakerOpen) {
    const timeSinceLastFailure = Date.now() - healingState.lastSuccessTime;
    if (timeSinceLastFailure > 60000) { // 1 minute cooldown
      console.log(`🔧 [Atlas Self-Healing] Resetting circuit breaker after ${timeSinceLastFailure}ms`);
      healingState.circuitBreakerOpen = false;
      healingState.consecutiveFailures = 0;
      healingState.recoveryAttempts++;
    } else {
      throw new Error(`Circuit breaker open - cooling down for ${60000 - timeSinceLastFailure}ms`);
    }
  }
  
  // EIDOLON-MATCHING: Single provider (Claude only, no fallback chain)
  const fn = PROVIDERS.anthropic;
  
  try {
    console.log(`[Atlas] Using Claude Opus 4.5 (unified configuration)...`);
    const result = await fn({ system, user, json });
    console.log(`✅ [Atlas] Claude succeeded in ${result.elapsed_ms}ms`);
    
    // Self-healing: Reset failure counters on success
    healingState.consecutiveFailures = 0;
    healingState.lastSuccessTime = Date.now();
    healingState.circuitBreakerOpen = false;
    
    return result;
  } catch (err) {
    const errorMsg = err.message || String(err);
    console.error(`❌ [Atlas] Claude failed:`, errorMsg);
    
    // Self-healing: Track failures
    healingState.consecutiveFailures++;
    
    // Self-healing: Open circuit breaker after threshold
    if (healingState.consecutiveFailures >= 3) {
      console.error(`🚨 [Atlas Self-Healing] Circuit breaker triggered after ${healingState.consecutiveFailures} failures`);
      healingState.circuitBreakerOpen = true;
    }
    
    const error = new Error("Atlas Agent (Claude Opus 4.5) failed");
    error.code = "atlas_claude_failed";
    error.details = [{ provider: "anthropic", error: errorMsg }];
    error.healingState = healingState;
    throw error;
  }
}

// Self-healing health check endpoint
export function getAgentHealth() {
  return {
    healthy: !healingState.circuitBreakerOpen,
    consecutiveFailures: healingState.consecutiveFailures,
    lastSuccessTime: healingState.lastSuccessTime,
    timeSinceLastSuccess: Date.now() - healingState.lastSuccessTime,
    circuitBreakerOpen: healingState.circuitBreakerOpen,
    recoveryAttempts: healingState.recoveryAttempts
  };
}
