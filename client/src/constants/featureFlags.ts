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
 * When true, the Rideshare Coach reads responses aloud chunk-by-chunk as each
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
