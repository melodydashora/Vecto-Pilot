# Google Maps requested-library readiness — 2026-09-11

Provenance: Astra venue/backend subagent, bounded frontend todo 65 follow-up
authorized by root during the September 11 sprint. Base checkpoint:
`21506372a85c0ae1e42b4cce9ac09e129b219917`. No StrategyMap, location, runtime,
database, shared test configuration, dependency, or credential changes.

## Trigger and behavior

StrategyMap requests maps, marker, and geometry, then constructs
`google.maps.marker.AdvancedMarkerElement`. The existing loader resolved any
cached `window.google.maps`, or the direct script callback, even when marker
was absent. Two synthetic tests reproduced premature resolution before source
changes: both failed with `settled === true` while marker import remained pending.

The loader now shares script ownership separately from readiness for each
requested library set. Missing capabilities use `google.maps.importLibrary()`;
the requested namespace must expose its required API before the caller resolves.
Equivalent/overlapping requests share work; a later marker request cannot inherit
an earlier maps-only result. Fully loaded namespaces keep the fast path. Failed
imports clear their readiness entry for a deliberate retry while retaining the
healthy shared script. Script failures retain retry behavior, and stale error
handlers cannot delete the current callback. No script is removed.

Library options, default maps/marker/geometry selection, map ID, async loading,
weekly version, callback, and existing public return type are preserved. Required
API checks cover the loader's existing library union; this does not add a caller
or promise support for provider-retired libraries.

## Focused verification

Run from this checkout using the existing workspace dependencies:

```sh
NODE_OPTIONS=--experimental-vm-modules node /home/runner/workspace/node_modules/jest/bin/jest.js --config jest.client.config.js --runInBand --runTestsByPath tests/client/google-maps-loader.test.ts
```

Before production changes: 2/2 behavioral regressions failed (exit 1, 10.053s).
Final focused run: **16/16 passed**, one suite, exit 0, 6.380s. Tests include both
partial-namespace paths, complete namespace fast paths, unavailable/rejected/
incomplete imports, concurrent shared requests, libraries added before and after
script readiness, explicit geometry/empty options, script/callback/missing-key
retry, stale script error fencing, and preserved script configuration/no removal.
The tests intercept script insertion and supply synthetic namespaces, imports,
and environment values; they perform no Google request, GPS access, or key lookup.
All Jest processes exited; no child/wait remains.

Scoped ESLint reports no loader errors; the repository ESLint configuration
ignores the test path (one warning). `git diff --check` passes.

The existing client Jest config and import-meta transformer were reused. Shared
client type checking/build belong to root's integration checkpoint. This focused
result does not establish live Google authorization, map-ID validity, tiles, or
rendered markers. No live provider or browser acceptance was run for this change.

## Primary documentation checked

Google documents `importLibrary()` after direct script loading and qualified
namespace use after awaiting the library in its [Maps JavaScript loading guide](https://developers.google.com/maps/documentation/javascript/load-maps-js-api).
The [advanced marker guide](https://developers.google.com/maps/documentation/javascript/advanced-markers/add-marker)
identifies the marker library as the source of `AdvancedMarkerElement`.

Owned paths: `client/src/lib/maps/google-maps-loader.ts`,
`tests/client/google-maps-loader.test.ts`, and this handoff. Other concurrent
chart and Briefing edits were preserved. Root owns final integration and
continuity writeback; this subagent performed no commit or runtime restart.
