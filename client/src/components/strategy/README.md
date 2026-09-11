# Strategy components

The active `pages/co-pilot/StrategyPage.tsx` uses:

- `StrategyMap.tsx` for current venue/event/traffic map data.
- `PreviousStrategyCard.tsx` for read-only advice from the same authenticated
  session while the current Strategy is unavailable. The card receives only
  historical text, owner/snapshot provenance, original city/timezone and a client
  receipt timestamp. It has no venue, navigation or feedback actions.
- `StrategyText.tsx` for literal text, line breaks and simple bold emphasis in
  current and historical advice. It does not interpret advice as HTML.

`CoPilotProvider` owns the in-memory completed-advice record and can show its
card inside the existing blocking error screen. Current Briefing/Strategy state
and venue generation remain separate from that historical display. A cold reload
starts without a historical record; no persistence or age policy is introduced.

The `_future/` components remain staged and are not the active page/provider
path. The previous future-only README is preserved under
`docs/architecture/removals/2026-09-11-strategy-components.md`.
