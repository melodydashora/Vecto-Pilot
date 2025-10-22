// server/util/circuit.js
// Circuit breaker for external API calls - no fallbacks, fail-fast only
const STATE = { CLOSED: 'closed', OPEN: 'open', HALF: 'half' };

export function makeCircuit({ name, failureThreshold = 5, resetAfterMs = 15000, timeoutMs = 5000 }) {
  let state = STATE.CLOSED;
  let fails = 0;
  let nextProbeAt = 0;

  return async function run(fetcher) {
    const now = Date.now();
    if (state === STATE.OPEN && now < nextProbeAt) {
      const err = new Error(`${name}: circuit_open`);
      err.code = 'circuit_open';
      throw err;
    }
    if (state === STATE.OPEN && now >= nextProbeAt) state = STATE.HALF;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetcher(ac.signal);
      clearTimeout(t);
      if (state === STATE.HALF) {
        state = STATE.CLOSED;
        fails = 0;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      fails += 1;
      if (fails >= failureThreshold) {
        state = STATE.OPEN;
        nextProbeAt = Date.now() + resetAfterMs;
      }
      // Try to set code property, but some errors have read-only code
      try {
        if (!e.code) e.code = 'upstream_failed';
      } catch (codeErr) {
        // Ignore - some error objects have read-only code property
      }
      throw e;
    }
  };
}
