// server/lib/llm-router-v2.js
// Multi-model hedged router with strict total budget, proper cancellation,
// and failure classification so circuit breakers don't trip on aborts.
// ESM. Requires Node 18+ (global fetch).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

function classify(err) {
  const msg = String(err && (err.name || err.code || err.message || err)).toLowerCase();
  if (msg.includes('aborted')) return { kind: 'ABORTED' };
  if (msg.includes('timeout')) return { kind: 'TIMEOUT' };
  if (msg.includes('429')) return { kind: 'THROTTLED' };
  if (msg.includes('5') && msg.includes('anthropic')) return { kind: 'SERVER' };
  if (msg.includes('5') && msg.includes('openai')) return { kind: 'SERVER' };
  if (msg.includes('5') && msg.includes('gemini')) return { kind: 'SERVER' };
  return { kind: 'OTHER' };
}

class CircuitBreaker {
  constructor({ threshold = 5, cooldownMs = 60_000 } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.errors = 0;
    this.state = 'CLOSED';
    this.until = 0;
  }
  recordSuccess() { this.errors = 0; this.state = 'CLOSED'; }
  recordFailure(kind) {
    // Only hard provider failures should count against the breaker.
    if (kind === 'THROTTLED' || kind === 'SERVER' || kind === 'OTHER') {
      this.errors++;
      if (this.errors >= this.threshold) {
        this.state = 'OPEN';
        this.until = now() + this.cooldownMs;
      }
    }
    // ABORTED/TIMEOUT from our global budget shouldn't open the breaker
  }
  available() {
    if (this.state !== 'OPEN') return true;
    if (now() >= this.until) { this.state = 'HALF'; this.errors = 0; return true; }
    return false;
  }
}

class Gate {
  constructor(limit) { this.limit = limit; this.inFlight = 0; this.queue = []; }
  async run(fn) {
    if (this.inFlight >= this.limit) await new Promise(res => this.queue.push(res));
    this.inFlight++; try { return await fn(); } finally { this.inFlight--; const n = this.queue.shift(); if (n) n(); }
  }
}

const cfg = (k, d) => process.env[k] ?? d;

function buildProviders() {
  const P = [];

  if (process.env.ANTHROPIC_API_KEY) {
    const breaker = new CircuitBreaker({
      threshold: Number(cfg('CIRCUIT_ERROR_THRESHOLD','5')),
      cooldownMs: Number(cfg('CIRCUIT_COOLDOWN_MS','60000')),
    });
    const gate = new Gate(Number(cfg('ANTHROPIC_MAX_CONCURRENCY','10')));
    const model = cfg('ANTHROPIC_MODEL','claude-opus-4-5-20251101');
    P.push({
      key: 'anthropic', model, breaker, gate,
      call: async ({ system, user, perCallMs, signal }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('anthropic-timeout')), perCallMs);
        const composite = new AbortController();
        const onAbort = () => composite.abort(new Error('global-timeout'));
        signal?.addEventListener('abort', onAbort, { once: true });
        // Tie provider controller to composite, so either can abort
        const anySignal = new AbortController();
        const onAbort2 = () => anySignal.abort(new Error('abort'));
        controller.signal.addEventListener('abort', onAbort2, { once: true });
        composite.signal.addEventListener('abort', onAbort2, { once: true });
        try {
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: Number(cfg('LLM_MAX_TOKENS', '4096')),
              temperature: Number(process.env._OVERRIDE_LLM_PARAM || cfg('LLM_TEMPERATURE', '0.7')),
              system,
              messages: [{ role: 'user', content: user }],
            }),
            signal: anySignal.signal,
          });
          const text = await (async () => {
            if (!resp.ok) throw new Error(`Anthropic ${resp.status}`);
            const data = await resp.json();
            return data?.content?.[0]?.text ?? '';
          })();
          return text;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        }
      }
    });
  }

  if (process.env.OPENAI_API_KEY) {
    const breaker = new CircuitBreaker({
      threshold: Number(cfg('CIRCUIT_ERROR_THRESHOLD','5')),
      cooldownMs: Number(cfg('CIRCUIT_COOLDOWN_MS','60000')),
    });
    const gate = new Gate(Number(cfg('OPENAI_MAX_CONCURRENCY','12')));
    const openaiModel = cfg('OPENAI_MODEL','gpt-5');
    P.push({
      key: 'openai', model: openaiModel, breaker, gate,
      call: async ({ system, user, perCallMs, signal }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('openai-timeout')), perCallMs);
        const composite = new AbortController();
        const onAbort = () => composite.abort(new Error('global-timeout'));
        signal?.addEventListener('abort', onAbort, { once: true });
        const anySignal = new AbortController();
        const onAbort2 = () => anySignal.abort(new Error('abort'));
        controller.signal.addEventListener('abort', onAbort2, { once: true });
        composite.signal.addEventListener('abort', onAbort2, { once: true });
        try {
          const requestBody = {
            model: openaiModel,
            max_completion_tokens: Number(cfg('LLM_MAX_TOKENS', '4096')),
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: user },
            ],
          };
          
          // GPT-5 supports reasoning_effort but NOT temperature/top_p/frequency_penalty
          const reasoningEffort = process.env._OVERRIDE_LLM_PARAM || cfg('OPENAI_REASONING_EFFORT', 'minimal');
          if (reasoningEffort && ['minimal', 'low', 'medium', 'high'].includes(reasoningEffort)) {
            requestBody.reasoning_effort = reasoningEffort;
          }
          
          const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(requestBody),
            signal: anySignal.signal,
          });
          const text = await (async () => {
            if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
            const data = await resp.json();
            return data?.choices?.[0]?.message?.content ?? '';
          })();
          return text;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        }
      }
    });
  }

  if (process.env.GEMINI_API_KEY) {
    const breaker = new CircuitBreaker({
      threshold: Number(cfg('CIRCUIT_ERROR_THRESHOLD','5')),
      cooldownMs: Number(cfg('CIRCUIT_COOLDOWN_MS','60000')),
    });
    const gate = new Gate(Number(cfg('GEMINI_MAX_CONCURRENCY','12')));
    const geminiModel = cfg('GEMINI_MODEL','gemini-3-pro-preview');
    P.push({
      key: 'google', model: geminiModel, breaker, gate,
      call: async ({ system, user, perCallMs, signal }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('gemini-timeout')), perCallMs);
        const composite = new AbortController();
        const onAbort = () => composite.abort(new Error('global-timeout'));
        signal?.addEventListener('abort', onAbort, { once: true });
        const anySignal = new AbortController();
        const onAbort2 = () => anySignal.abort(new Error('abort'));
        controller.signal.addEventListener('abort', onAbort2, { once: true });
        composite.signal.addEventListener('abort', onAbort2, { once: true });
        try {
          // FIX: API key in URL as query parameter, no x-goog-api-key header needed
          const apiKey = process.env.GEMINI_API_KEY;
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
          const parts = [{ text: user }];
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
              generationConfig: { 
                temperature: Number(process.env._OVERRIDE_LLM_PARAM || cfg('LLM_TEMPERATURE', '0.7')),
                maxOutputTokens: Number(cfg('LLM_MAX_TOKENS', '4096'))
              },
            }),
            signal: composite.signal,
          });
          const text = await (async () => {
            if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
            const data = await resp.json();
            return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
          })();
          return text;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        }
      }
    });
  }

  return P;
}

function desiredOrder(providers) {
  const primary = (cfg('PREFERRED_MODEL','google:gemini-2.5-pro')||'').split(':')[0];
  const fallbacks = (cfg('FALLBACK_MODELS','openai:gpt-5,anthropic:claude-opus-4-5-20251101')||'')
    .split(',').map(s => s.trim().split(':')[0]).filter(Boolean);
  const map = Object.fromEntries(providers.map(p => [p.key, p]));
  const ordered = [primary, ...fallbacks].map(k => map[k]).filter(Boolean);
  for (const p of providers) if (!ordered.includes(p)) ordered.push(p);
  return ordered;
}

export async function routeLLMTextV2({ system, user, log = console, overrides = null }) {
  const t0 = now();
  let providers = buildProviders();
  if (!providers.length) return { ok: true, provider: 'none', text: '', tookMs: 0, errors: [{ error:'no-providers' }] };

  // Testing override: force single model with custom parameter
  if (overrides?.modelKey && overrides?.modelParam) {
    const modelMap = { 'gemini': 'google', 'gpt-5': 'openai', 'claude': 'anthropic' };
    const providerKey = modelMap[overrides.modelKey];
    providers = providers.filter(p => p.key === providerKey);
    
    // Override provider call with custom parameter
    if (providers.length > 0) {
      const origCall = providers[0].call;
      providers[0].call = async (opts) => {
        // Inject custom parameter into provider call
        process.env._OVERRIDE_LLM_PARAM = overrides.modelParam;
        try {
          return await origCall(opts);
        } finally {
          delete process.env._OVERRIDE_LLM_PARAM;
        }
      };
      log.log(`🧪 Testing override: ${overrides.modelKey} with param=${overrides.modelParam}`);
    }
  }

  const ordered = desiredOrder(providers);
  const primary = ordered[0];
  const backups = ordered.slice(1);

  const totalBudget = Number(cfg('LLM_TOTAL_BUDGET_MS','8000'));
  const hedgeDelay = Number(cfg('LLM_PRIMARY_TIMEOUT_MS','1200'));
  const stagger = Number(cfg('FALLBACK_HEDGE_STAGGER_MS','400'));
  const perCallMs = Math.max(1200, Math.floor(totalBudget * 0.5));

  // A global budget controller to cancel all providers when budget expires
  const budgetController = new AbortController();
  const budgetTimer = setTimeout(() => budgetController.abort(new Error('total-budget-timeout')), totalBudget);

  const errors = [];
  let winner = null;

  const runProvider = async (prov) => {
    if (!prov.breaker.available()) {
      return { ok:false, key: prov.key, error: 'breaker-open' };
    }
    try {
      const text = await prov.gate.run(() => prov.call({ system, user, perCallMs, signal: budgetController.signal }));
      if (text) { prov.breaker.recordSuccess(); return { ok:true, key:prov.key, text }; }
      return { ok:false, key:prov.key, error:'empty' };
    } catch (e) {
      const { kind } = classify(e);
      if (kind === 'ABORTED' || kind === 'TIMEOUT') {
        // Don't count against breaker
      } else {
        prov.breaker.recordFailure(kind);
      }
      return { ok:false, key:prov.key, error:String(e?.message||e), kind };
    }
  };

  // Fire primary immediately
  const tasks = [];
  const tPrimary = (async () => {
    const r = await runProvider(primary);
    if (r.ok && !winner) winner = r;
    else if (!r.ok) errors.push({ provider:r.key, error:r.error, kind:r.kind });
  })();
  tasks.push(tPrimary);

  // Start backups after hedgeDelay, staggered
  const tBackups = (async () => {
    await sleep(hedgeDelay);
    for (let i=0;i<backups.length;i++) {
      if (winner) break;
      const p = backups[i];
      const t = runProvider(p).then(r => {
        if (r.ok && !winner) winner = r;
        else if (!r.ok) errors.push({ provider:r.key, error:r.error, kind:r.kind });
      });
      tasks.push(t);
      await sleep(stagger);
    }
  })();
  tasks.push(tBackups);

  // Wait until we have a winner, or budget expires
  while (!winner) {
    if (budgetController.signal.aborted) break;
    await sleep(50);
  }

  // Stop everything else immediately
  clearTimeout(budgetTimer);
  budgetController.abort(new Error('winner-selected'));

  // Drain tasks (they will exit quickly due to aborted signals)
  await Promise.allSettled(tasks);

  const tookMs = now() - t0;
  if (!winner) return { ok:true, provider:'none', text:'', tookMs, errors };

  return { ok:true, provider:winner.key, text:winner.text, tookMs, errors };
}

export function routerDiagnosticsV2() {
  const providers = buildProviders();
  return {
    providers: providers.map(p => ({ key: p.key })),
    preferred: process.env.PREFERRED_MODEL,
    fallbacks: process.env.FALLBACK_MODELS,
  };
}
