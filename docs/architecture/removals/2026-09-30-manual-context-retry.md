# Manual context retry boundaries

Provenance: Codex/Astra frontend adversarial review, September 30, 2026.
Melody authorized further application root-cause fixes after the initial suite.

In `client/src/contexts/location-context-clean.tsx`, the former ownership-error
condition accepted the old displayed snapshot during a new capture. A delayed
failure for that old snapshot aborted the driver's manual GPS retry. An active
capture now accepts failures for its own capture identity; saved-context failures
still hold the context when no capture is active. Permission revocation retains
its cancellation behavior. The capture identity is set synchronously before
asynchronous GPS so the error fence does not depend on a completed render.

In `client/src/pages/co-pilot/StrategyPage.tsx`, a manual Strategy click formerly
delegated directly to admission after a temporary canonical setup read failed.
The provider correctly refused unconfirmed setup, leaving the enabled click with
no recovery action. That explicit click now retries the existing canonical GET
when its prior read failed, then consumes a confirmed prepared snapshot. Loading,
pending saves, unsaved drafts, changed preferences and unfinished context remain
held. It does not recapture GPS or regenerate Briefing.

Independent failed regressions and final synthetic verification are preserved in
the existing private coordination directory under
`strategy-refresh-20260929/frontend/adversarial-20260930`. No live provider,
physical-device or publication acceptance is claimed by these tests.
