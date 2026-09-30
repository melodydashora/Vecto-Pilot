// server/util/circuit.js
// Circuit breaker for external API calls - no fallbacks, fail-fast only
const STATE = { CLOSED: 'closed', OPEN: 'open', HALF: 'half' };

export function makeCircuit({ name, failureThreshold = 5, resetAfterMs = 15000, timeoutMs = 5000 }) {
  let state = STATE.CLOSED;
  let fails = 0;
  let nextProbeAt = 0;
  // Old in-flight completions cannot change a newer open/recovery cycle.
  let generation = 0;

  return async function run(fetcher) {
    const now = Date.now();
    if (state === STATE.HALF || (state === STATE.OPEN && now < nextProbeAt)) {
      const err = new Error(`${name}: circuit_open`);
      err.code = 'circuit_open';
      throw err;
    }
    if (state === STATE.OPEN && now >= nextProbeAt) state = STATE.HALF;
    const startedGeneration = generation;
    const isProbe = state === STATE.HALF;

    const ac = new AbortController();
    let t;
    const deadline = new Promise((_resolve, reject) => {
      t = setTimeout(() => {
        const error = Object.assign(new Error(`${name}: upstream_timeout`), { code: 'upstream_timeout' });
        ac.abort(error);
        reject(error);
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([Promise.resolve().then(() => fetcher(ac.signal)), deadline]);
      if (startedGeneration === generation) {
        if (isProbe) generation += 1;
        state = STATE.CLOSED;
        fails = 0;
      }
      return res;
    } catch (e) {
      if (startedGeneration === generation) {
        fails += 1;
        if (isProbe || fails >= failureThreshold) {
          state = STATE.OPEN;
          generation += 1;
          nextProbeAt = Date.now() + resetAfterMs;
        }
      }
      // Try to set code property, but some errors have read-only code
      try {
        if (!e.code) e.code = 'upstream_failed';
      } catch (codeErr) {
        // Ignore - some error objects have read-only code property
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  };
}
