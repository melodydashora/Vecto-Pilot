# Briefing cards

Cards render persisted Briefing sections supplied by the existing Briefing page.

## AirportCard

September 11, 2026: Reconciled the recovered September 10 FAA consumer work with
the current frontend. FAA disruption fields display their reason and original
feed/fetch timestamps. Ground stops, restrictions and observed delays take
precedence over an optimistic model badge. A restriction retains its scope;
only an explicit closure uses the reopening label. Unknown FAA coverage is
neutral and unquantified delay remains unquantified. Legacy model-only rows
remain readable; a missing status is unknown.

The pipeline contract supplies `faa_has_delays`, `faa_ground_stops`, nullable
minutes, closure scope/start/end, coverage and source metadata. A ground-stop
list alone is sufficient to show a disruption. The card never substitutes
render or retrieval time for source time. The collapse control is a native
button with expanded state; long airport names and FAA text can wrap.

Focused DOM checks are in `tests/briefing/airport-status.ui.test.tsx`, using the
isolated `tests/briefing/jest.airport-ui.config.cjs` harness. Fixtures are
synthetic and do not establish live FAA availability or deployment state.
