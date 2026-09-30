# Cached snapshot source gate — September 11, 2026

In `server/api/strategy/content-blocks.js`, the following comment from base `a4d3ab92` has been replaced:

```text
// 2026-07-06: the snapshots fetch that used to sit here is gone — its only
// consumers were the holiday reads, which now come from briefings.holiday.
```

The ownership middleware already reads and attaches the full saved snapshot. The Strategy poll route now checks that row's quality before presenting Strategy as ready. A newly pending snapshot remains pending; a broken completed source requires a fresh location. Saved partial source data remains available through the Coach context routes.

The recommendations GET now also applies the shared snapshot validator after ownership and before either cached ranking reuse or missing-ranking provider work. This closes a path that previously relied on Strategy and Briefing status without validating snapshot quality. No model, schema, provider, or authentication behavior changed.

The Strategy poll response includes `strategyUpdatedAt` (and compatibility `generatedAt`) from the saved Strategy `updated_at`, `strategyCreatedAt` from its `created_at`, and `snapshotCreatedAt` from the owned snapshot. Invalid/missing dates are null. `updated_at` is a record update time and can reflect a phase write; it is not claimed to be a dedicated model-generation timestamp. No read-time timestamp substitutes for source time.
