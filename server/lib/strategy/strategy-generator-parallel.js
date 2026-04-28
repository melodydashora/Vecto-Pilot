// server/lib/strategy-generator-parallel.js
// LEGACY: Parallel multi-model strategy orchestration. All functions in this
// file are DEAD CODE; the active pipeline is blocks-fast.js → consolidator.js
// → runImmediateStrategy(). Stubs kept so that snapshot.js →
// generateStrategyForSnapshot() → generateMultiStrategy() doesn't crash.
// That path returns null gracefully (feature_disabled).
// TODO: Remove strategy-generator.js + snapshot.js references in a future cleanup pass.

/**
 * LEGACY: Parallel multi-model strategy — feature-gated OFF since Dec 2025.
 * Active path is blocks-fast.js → runImmediateStrategy() in consolidator.js.
 * @returns {{ ok: false, reason: string }}
 */
export async function generateMultiStrategy() {
  return { ok: false, reason: 'feature_disabled' };
}

/**
 * LEGACY: Simple strategy pipeline — never called by any consumer.
 * Kept as export for backwards compatibility with index.js barrel.
 * @returns {{ ok: false, reason: string }}
 */
export async function runSimpleStrategyPipeline() {
  return { ok: false, reason: 'legacy_disabled' };
}
