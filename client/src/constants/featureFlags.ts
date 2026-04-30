/**
 * Centralized feature flags for the Vecto Pilot client.
 *
 * 2026-04-27: Created in Step 5 of COACH_PASS2_PHASE_B_PLAN.
 *
 * Pattern: each flag is a runtime boolean derived from `import.meta.env`
 * (Vite's compile-time substitution) with a code-side default. The env override
 * gives a local kill-switch without a code change.
 */

/**
 * When true, the Coach reads responses aloud chunk-by-chunk as each
 * sentence completes (vs. waiting for the full response).
 *
 * Default: `false` (Step 5). Step 6 flips the default to `true`.
 * Override: `VITE_COACH_STREAMING_TTS=true|false` in `.env.local`.
 */
export const COACH_STREAMING_TTS_ENABLED: boolean = (() => {
  const override = import.meta.env.VITE_COACH_STREAMING_TTS;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return false; // default — Step 6 flips this to true
})();

// 2026-04-27 (Commit 4 of CLEAR_CONSOLE_WORKFLOW spec):
// Frontend debug flags for noisy diagnostic console.log lines that should be
// off by default in normal operation. Each flag defaults to false. Set the
// matching VITE_DEBUG_* in `.env.local` and rebuild to enable.

function _readBoolFlag(envValue: string | undefined): boolean {
  return envValue === 'true';
}

/** Gate Strategy map lifecycle logs (init, tiles, container size). Default false. */
export const DEBUG_MAP_ENABLED: boolean = _readBoolFlag(import.meta.env.VITE_DEBUG_MAP);

/** Gate venue/bars marker-count and prefetch logs (StrategyMap, useBarsQuery). Default false. */
export const DEBUG_VENUES_ENABLED: boolean = _readBoolFlag(import.meta.env.VITE_DEBUG_VENUES);

/** Gate SSE Manager connection-churn logs (subscribers, reuses, handshakes). Default false. */
export const DEBUG_SSE_ENABLED: boolean = _readBoolFlag(import.meta.env.VITE_DEBUG_SSE);

/** Gate BlockFilter decision logs (per-block selection rationale). Default false. */
export const DEBUG_BLOCKS_ENABLED: boolean = _readBoolFlag(import.meta.env.VITE_DEBUG_BLOCKS);
