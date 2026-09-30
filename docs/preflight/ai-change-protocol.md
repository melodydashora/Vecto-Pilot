# Preflight: AI changes

Source-reconciled September 29, 2026. This card supplements [AI model preflight](ai-models.md); it does not duplicate registry schemas or provider parameter examples.

1. Trace the actual entry, current session/run, saved source, model input, output validation, writes and UI. Use the [pipeline map](../architecture/ai-pipeline.md) to find source; verify it before editing.
2. Use registered roles through the [adapter](../../server/lib/ai/adapters/index.js). Model pins live in [model-registry.js](../../server/lib/ai/model-registry.js), not environment overrides. Voice/token/transport adapters have distinct lifecycles; a direct provider URL alone is not proof of an accidental duplicate.
3. Validate `{ ok, output }` and the required response shape. Missing output, malformed JSON, canceled work and provider failures cannot become invented success. Preserve explicit zero and unknown values.
4. Propagate cancellation and recheck ownership/source generation before committing results. Generic retries must not replay writes of unknown commit status. Test concurrent callers and late results where they cross these boundaries.
5. Follow [location preflight](location.md): preserve measured coordinates, timestamps and accuracy; six-decimal keys are not proof of accuracy. Never invent country, timezone, identity, route measurements or staging coordinates.
6. Keep credentials, raw private driver data and transcripts out of logs, commits and public reports. Preserve useful diagnostics with explicit provenance and controlled local storage.
7. Run the appropriate contract/regression tests, lint and typecheck. Provider contract examples must come from current official documentation. `guard:models` performs live provider requests; ordinary offline verification does not require it.

The January card's `envKey/default` registry example, grep-only pseudo-CI and copied model/precision claims were removed because they contradicted source. Recovery is recorded in the [pipeline removal ledger](../architecture/removals/2026-09-29-pipeline-review.md).
