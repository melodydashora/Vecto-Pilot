# Held setup and the location header

Provenance: Codex/Astra, September 29, 2026, implementing Melody's explicit
Continue requirement during Browser Astra recovery.

The old GlobalHeader timeout started on component mount. With the new admitted
location provider, a mounted header with no coordinates is expected while the
driver reviews setup or saved offers. After 30 seconds, that old timer incorrectly
reported a location failure and replaced the dashboard, including held workflows.

The header now starts its existing 30-second timeout only for LocationContext's
current admitted run. Holding or replacing that run cancels its timer. Real current
collection errors remain visible immediately, and confirmed location cancels the
timer. Resolution follows the provider receipt, including valid zero coordinates.

Removed obsolete comments claiming the header polls the users table, creates
snapshots on app open/manual refresh, or that reload automatically collects GPS.
The header reads context; only final Continue admits collection. Removed old refresh
events and the unsupported "Location updated" toast: refresh now explains the return
to setup. Removed the location-string debug log, which could disclose a full address.
Held state does not display a fabricated "just now" receipt or claim GPS is running.

Palette review read UI_SCHEMA_COLOR_PALETTE-DONE.md, index.css and button variants.
The document's signature uses violet while this existing driver header uses purple;
the current blue-to-purple header, semantic colors and theme tokens are preserved.
The public guest page uses its separate ConciergeHeader and is not changed.

Verification lives in tests/client/held-header.test.tsx and durable private recovery
logs under .config/astra-vecto-coordination/p0-readiness-20260929/recovery-20260929/.
The tests use the real header and CoPilot provider with synthetic owned location
state. Browser verification and full P1 completion remain separate checks.
