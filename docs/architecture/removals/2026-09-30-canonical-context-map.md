# Canonical location and pending venue maps

Provenance: Codex/Astra frontend root-cause review, September 30, 2026.
Melody requested root-cause analysis and fixes before publication.

In `client/src/contexts/location-context-clean.tsx`, replaced the once-per-scope
hydration guard with a comparison of the server's canonical context. The old
guard also discarded a genuinely changed saved snapshot or completed preparation
returned by an existing same-session read. Unchanged reads preserve local holds;
changed context is adopted without GPS, workflow POSTs or generation. Missing
context after initialization remains a manual retry, and revoked permission
continues to hold Strategy. The hydration comment now describes reconciliation
and manual recovery rather than only initial restoration.

In `client/src/pages/co-pilot/StrategyPage.tsx`, the prior-map display condition
now includes `pending_blocks`. New Strategy text may arrive while replacement
venues are still preparing; the previously completed map stays visible through
that intermediate phase. The completed replacement selects its own map.

Regression evidence is in the existing private coordination directory under
`strategy-refresh-20260929/frontend/root-cause-20260930`. Synthetic tests do not
establish physical-device or live-provider acceptance.
