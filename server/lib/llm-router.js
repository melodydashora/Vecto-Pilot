// Multi-model LLM router with hedging, circuit breakers, and fallback
// Using Node.js built-in fetch (available in Node 18+)

// Provider configurations
const PROVIDERS = {
  anthropic: {
    name: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    maxConcurrency: parseInt(process.env.ANTHROPIC_MAX_CONCURRENCY) || 10,
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }),
    buildBody: (system, user) => ({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
      system,
      messages: [{ role: 'user', content: user }]
    }),
    extractText: (data) => data.content?.[0]?.text || '',
    apiKeyEnv: 'ANTHROPIC_API_KEY'
  },
  openai: {
    name: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    maxConcurrency: parseInt(process.env.OPENAI_MAX_CONCURRENCY) || 12,
    headers: (apiKey) => ({
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json'
    }),
    buildBody: (system, user) => ({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      max_completion_tokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    extractText: (data) => data.choices?.[0]?.message?.content || '',
    apiKeyEnv: 'OPENAI_API_KEY'
  },
  google: {
    name: 'google',
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-pro'}:generateContent`,
    maxConcurrency: parseInt(process.env.GEMINI_MAX_CONCURRENCY) || 12,
    headers: () => ({
      'content-type': 'application/json'
    }),
    buildBody: (system, user) => ({
      contents: [{
        parts: [{ text: `${system}\n\n${user}` }]
      }],
      generationConfig: {
        maxOutputTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4096,
        temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7
      }
    }),
    extractText: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    apiKeyEnv: 'GEMINI_API_KEY',
    useQueryParam: true // Gemini uses ?key= query param
  }
};

// Circuit breaker state
const circuitState = {
  anthropic: { failures: 0, isOpen: false, openedAt: 0 },
  openai: { failures: 0, isOpen: false, openedAt: 0 },
  google: { failures: 0, isOpen: false, openedAt: 0 }
};

// Concurrency tracking
const activeRequests = {
  anthropic: 0,
  openai: 0,
  google: 0
};

// Configuration
const CONFIG = {
  primaryTimeout: parseInt(process.env.LLM_PRIMARY_TIMEOUT_MS) || 1200,
  totalBudget: parseInt(process.env.LLM_TOTAL_BUDGET_MS) || 30000, // 30s total budget
  providerTimeout: parseInt(process.env.LLM_PROVIDER_TIMEOUT_MS) || 25000, // 25s per provider
  circuitErrorThreshold: parseInt(process.env.CIRCUIT_ERROR_THRESHOLD) || 5,
  circuitCooldown: parseInt(process.env.CIRCUIT_COOLDOWN_MS) || 60000,
  preferredModel: process.env.PREFERRED_MODEL || 'google:gemini-2.5-pro',
  fallbackModels: (process.env.FALLBACK_MODELS || 'openai:gpt-5,anthropic:claude-sonnet-4-5-20250929').split(',')
};

// Parse provider from config string
function parseProvider(modelString) {
  const [provider] = modelString.split(':');
  return provider;
}

// Check if circuit breaker is open
function isCircuitOpen(providerName) {
  const state = circuitState[providerName];
  if (!state.isOpen) return false;
  
  const now = Date.now();
  if (now - state.openedAt > CONFIG.circuitCooldown) {
    // Reset circuit after cooldown
    state.isOpen = false;
    state.failures = 0;
    state.openedAt = 0;
    console.log(`🔄 Circuit breaker reset for ${providerName}`);
    return false;
  }
  
  return true;
}

// Record failure and trip circuit if needed
function recordFailure(providerName) {
  const state = circuitState[providerName];
  state.failures++;
  
  if (state.failures >= CONFIG.circuitErrorThreshold) {
    state.isOpen = true;
    state.openedAt = Date.now();
    console.error(`⚡ Circuit breaker OPEN for ${providerName} (${state.failures} failures)`);
  }
}

// Record success and reset failure count
function recordSuccess(providerName) {
  circuitState[providerName].failures = 0;
}

// Check if provider can accept more requests
function canAcceptRequest(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) return false;
  if (isCircuitOpen(providerName)) return false;
  if (activeRequests[providerName] >= provider.maxConcurrency) return false;
  return true;
}

// Call a single provider
async function callProvider(providerName, system, user, timeoutMs = CONFIG.providerTimeout) {
  const provider = PROVIDERS[providerName];
  const apiKey = process.env[provider.apiKeyEnv];
  
  if (!apiKey) {
    throw new Error(`${providerName}: API key not configured (${provider.apiKeyEnv})`);
  }
  
  activeRequests[providerName]++;
  const startTime = Date.now();
  
  try {
    const url = provider.useQueryParam 
      ? `${provider.endpoint}?key=${apiKey}`
      : provider.endpoint;
    
    const controller = new AbortController();
    // Use provider-specific timeout, not the total budget
    const actualTimeout = Math.min(timeoutMs, CONFIG.providerTimeout);
    const timeout = setTimeout(() => controller.abort(), actualTimeout);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: provider.headers(apiKey),
      body: JSON.stringify(provider.buildBody(system, user)),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const data = await response.json();
    const text = provider.extractText(data);
    
    if (!text) {
      throw new Error('Empty response from provider');
    }
    
    recordSuccess(providerName);
    const tookMs = Date.now() - startTime;
    
    return { text, provider: providerName, tookMs };
  } catch (error) {
    recordFailure(providerName);
    throw error;
  } finally {
    activeRequests[providerName]--;
  }
}

// Main routing function with hedging
export async function routeLLMText({ system, user }) {
  const startTime = Date.now();
  const errors = [];
  
  // Determine provider order
  const primaryProvider = parseProvider(CONFIG.preferredModel);
  const fallbackProviders = CONFIG.fallbackModels.map(parseProvider);
  
  // Try primary with hedging
  if (canAcceptRequest(primaryProvider)) {
    try {
      const primaryPromise = callProvider(primaryProvider, system, user, CONFIG.totalBudget);
      
      // Hedging: wait for primary timeout, then race with fallback
      const hedgeTimeout = new Promise(resolve => 
        setTimeout(() => resolve(null), CONFIG.primaryTimeout)
      );
      
      const primaryResult = await Promise.race([primaryPromise, hedgeTimeout]);
      
      if (primaryResult) {
        // Primary won the race
        return primaryResult;
      }
      
      // Primary is slow, start fallback race
      console.log(`⏱️ ${primaryProvider} slow (>${CONFIG.primaryTimeout}ms), racing fallbacks...`);
      
      const fallbackPromises = fallbackProviders
        .filter(canAcceptRequest)
        .map(provider => 
          callProvider(provider, system, user, CONFIG.providerTimeout)
            .catch(err => {
              errors.push(`${provider}: ${err.message}`);
              return null;
            })
        );
      
      // Race primary + fallbacks (all get full provider timeout)
      const results = await Promise.race([primaryPromise, ...fallbackPromises]);
      
      if (results) return results;
      
    } catch (error) {
      errors.push(`${primaryProvider}: ${error.message}`);
      console.error(`❌ ${primaryProvider} failed:`, error.message);
    }
  } else {
    errors.push(`${primaryProvider}: circuit open or at capacity`);
  }
  
  // Try fallbacks in order (with budget check)
  for (const fallbackProvider of fallbackProviders) {
    if (!canAcceptRequest(fallbackProvider)) {
      errors.push(`${fallbackProvider}: circuit open or at capacity`);
      continue;
    }
    
    const elapsed = Date.now() - startTime;
    if (elapsed >= CONFIG.totalBudget) {
      console.log(`⏱️ Total budget (${CONFIG.totalBudget}ms) exceeded, stopping fallback attempts`);
      break;
    }
    
    try {
      const result = await callProvider(fallbackProvider, system, user, CONFIG.providerTimeout);
      console.log(`✅ Fallback succeeded: ${fallbackProvider}`);
      return result;
    } catch (error) {
      errors.push(`${fallbackProvider}: ${error.message}`);
      console.error(`❌ ${fallbackProvider} failed:`, error.message);
    }
  }
  
  // All providers failed
  const tookMs = Date.now() - startTime;
  console.error(`💥 All LLM providers failed after ${tookMs}ms`);
  
  return { text: null, provider: 'none', tookMs, errors };
}

export default routeLLMText;
