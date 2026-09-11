# FAA consumer follow-up — September 10, 2026

Codex/Astra followed up the independent review of `2269e628..691aab8a` in the
existing FAA worktree, with the root agent handing over this bounded scope.
No live driver data, provider calls, application startup, database writes or
migrations were used. No push or deployment was performed by this agent.

## Result

- AirportCard displays the FAA reason, nullable delay duration, ground stops,
  restriction scope, and original source/fetch timestamps. Observed FAA
  disruptions take precedence over a model-normal badge. Unknown FAA status
  remains neutral. Model-only historical rows remain readable.
- The airport pipeline carries `faa_has_delays`, `faa_ground_stops`, and
  restriction start/end fields as well as its existing source metadata.
- The snapshot route uses a pure `buildAirportContext` mapper for both a
  successful FAA result and proximity-only context. Unknown minutes/flags stay
  null. A ground stop does not assert an airport-wide closure. The existing
  `has_closures` flag remains true for scoped restrictions, alongside the
  explicit `restricted` status and its reason; consumers must retain that scope.

## Verification

30 tests passed, using synthetic data only:

```text
node node_modules/jest/bin/jest.js --config tests/briefing/jest.airport-ui.config.cjs --runInBand
  8 AirportCard DOM tests passed

node --test tests/briefing/airport-context.node.test.mjs tests/briefing/faa-status.node.test.mjs
  6 snapshot mapper + 10 FAA parser/request tests passed

node --experimental-vm-modules node_modules/jest/bin/jest.js tests/briefing/airport-faa.test.js --runInBand
  6 airport pipeline tests passed

node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit --pretty false
  passed

node node_modules/eslint/bin/eslint.js client/src/components/briefing/AirportCard.tsx server/lib/location/airport-context.js server/api/location/location.js server/lib/briefing/pipelines/airport.js --max-warnings 0
  passed
```

The DOM tests mount the real card and UI primitives with no provider/DB imports.
The consumer tests exercise the pure mapper called by both real snapshot-route
branches; they do not start the full location route or persist a snapshot.
Existing dependencies were reused without installation. The isolated TSX config
does not change the shared test/package setup being maintained by another agent.

## Remaining integration checks

The root agent should review the combined FAA and Briefing-readiness branches,
then verify card layout on the hosted application and a narrow viewport. These
tests do not establish live FAA availability, deployment state, or current
airport conditions. The snapshot mapping is forward behavior; existing stored
snapshot rows were not rewritten. Source time is the FAA disruption-feed update
time; retrieval time is displayed separately and never substituted for it.
