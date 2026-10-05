# Location modules

Source index updated October 4, 2026. Read the current
[location contract](../../../docs/architecture/LOCATION.md),
[snapshot contract](../../../docs/architecture/SNAPSHOT.md) and
[MAIN sequence](../../../docs/architecture/ai-pipeline.md) for the complete
request, ownership and freshness rules.

| Module | Responsibility |
|---|---|
| [main-run-snapshot.js](main-run-snapshot.js) | Capture claim, measured upstream context and owned atomic snapshot publication. |
| [snapshot-readiness.js](snapshot-readiness.js) | Validate saved observation readiness for downstream consumers. |
| [snapshot-environment.js](snapshot-environment.js) | Environmental measurements with their original observation times. |
| [geocode.js](geocode.js), [resolveTimezone.js](resolveTimezone.js) | Coordinate-derived address and timezone resolution. |
| [coords-key.js](coords-key.js) | Validated six-decimal coordinate keys and retained compatibility aliases. |
| [geo.js](geo.js) | Existing distance and bearing utilities; callers must use the correct units and validation contract. |
| [getSnapshotTimeContext.js](getSnapshotTimeContext.js) | Time context derived from the saved snapshot. |
| [airport-context.js](airport-context.js) | Pure projection of FAA observations or explicitly unknown airport context. |

Six-decimal key resolution does not establish measured GPS accuracy. Coordinate
observation time, reported accuracy, timezone and capture identity remain
separate facts. Holiday intelligence belongs to Briefing; old snapshot-context
and validation-gate import examples were removed because those modules no
longer exist.

The January walkthrough is recoverable at
`b4bba633:server/lib/location/README.md` and in the external cleanup archive.
