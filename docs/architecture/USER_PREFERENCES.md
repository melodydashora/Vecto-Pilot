# Preferences, saved setup and MAIN admission

Source traced September 29, 2026. Preferences reduce repeated driver input and
keep recommendations consistent with the services the driver actually chooses.
Continue must work with valid saved options; editing is a choice, not a mandatory
ritual. [ai-pipeline.md](ai-pipeline.md) owns the full waterfall;
[RIDESHARE_COACH.md](RIDESHARE_COACH.md) owns Coach context/actions.

## Canonical storage and response

| Store/source | Contract |
|---|---|
| `driver_profiles` in [schema.js](../../shared/schema.js) | Identity/home address, platform choices, vehicle eligibility/attributes, service preferences, economic targets, `selected_services` and `settings_revision`. This is the canonical profile, not a second preference table. |
| `driver_vehicles` | Primary key **`id`**, foreign key **`driver_profile_id → driver_profiles.id`**. MAIN requires exactly one active primary vehicle with complete year/make/model/seatbelts. |
| `offer_rulesets` | Separate Analyzer rules/config, version and stored hash. Rules are validated/migrated for effective use; pinning them does not authorize sending them to MAIN models. |
| [driver-profile-response.js](../../server/lib/driver-profile-response.js) | Explicit camelCase API projection shared by login, `/me`, save and setup: session ID, settings revision, profile and active primary vehicle. Private DB fields are not copied wholesale. |
| [driver-preferences.js](../../server/lib/driver-preferences.js) | Economic input validation and explicit yes/no/unknown descriptions. Zero is a valid goal or pickup-distance limit; null means not supplied. |
| [driver-services.js](../../shared/driver-services.js) | Shared platform-neutral service taxonomy. Eligibility is capability; `selected_services` is explicit work selection. |

The old April guide incorrectly named vehicle keys, claimed Strategy/planner did
not receive preferences, and described home coordinates as GPS fallback. Those
claims are superseded. Current MAIN requires fresh precise device location;
home coordinates are profile context, never fabricated current position.

## Save → review → Continue

[SettingsPage.tsx](../../client/src/pages/co-pilot/SettingsPage.tsx), the Analyzer
rules editor and [run-setup-context.tsx](../../client/src/contexts/run-setup-context.tsx)
share setup ownership. The provider preserves drafts, tracks pending saves and
requires server readback before admitting Continue. An editor unmount does not
release a still-pending save; a canceled/stale Continue may release only its own
request slot. Cross-tab saved-setup changes invalidate the previous confirmation.

`PUT /api/auth/profile` accepts `expectedSettingsRevision`. The server validates
profile/economic/selection changes and commits profile plus primary vehicle under
[withDriverSettingsLock](../../server/lib/main-run-admission.js). A stale revision
returns conflict rather than overwriting another save. Expensive geocoding is
outside the lock; final ownership/revision is checked under it. Address changes
clear old derived home coordinates/timezone; resolution failure cannot leave
coordinates for an old address attached to a new one.

`GET /api/main-runs/setup` returns the authoritative saved projection, effective
rules, revision/hash, missing requirements and current run. `POST
/api/main-runs/continue` supplies one request UUID plus expected settings revision,
rules version/hash and current run ID. Both use the same owner lock as saves.
Continue rechecks the current session, required profile/terms/platform/vehicle,
selected services and valid saved rules before inserting an admission receipt.
Duplicate request IDs replay the same intent; conflicting or superseded intent
cannot silently launch another waterfall.

The stored raw rules hash proves which saved config was reviewed. Migration adds
inert effective fields without forcing a save. Existing drivers whose additive
`selected_services` field is null may Continue with a valid saved ruleset; their
service selection remains unspecified. This compatibility rule does **not**
infer active services from eligibility. New explicit selections must be unique,
nonempty and eligible (delivery has no vehicle-class eligibility flag).

Login/logout/settings change and a newer Continue invalidate obsolete work.
Snapshot attachment and every later stage/publication must prove the current
admission and source again; browser readiness alone is insufficient.

## Who receives what

| Consumer | Actual data boundary |
|---|---|
| Snapshot enrichment and Briefing discovery | Current verified location/time/environment, not Analyzer offer decisions. Preferences are not injected as a new discovery prompt in this review. |
| Strategist | [consolidator.js](../../server/lib/ai/providers/consolidator.js) loads the admitted profile/vehicle projection. It distinguishes capability, explicit selected services, willingness and economic targets. Missing fare/fuel inputs are unknown; goals are not forecasts. |
| Venue planner | [tactical-planner.js](../../server/lib/strategy/tactical-planner.js) receives saved Strategy, snapshot, bounded Briefing and the admitted driver context. It is the venue planner, not the Strategist. |
| Coach | [rideshare-coach-dal.js](../../server/lib/ai/rideshare-coach-dal.js) reads owner-scoped profile/vehicle, saved MAIN sources, notes and Analyzer rule/history context. Rule changes remain saved-only and require explicit activation through the Analyzer surface. |
| MAIN model prompts | `mainDriverContext(configuration)` passes **profile and vehicle only**. The admission receipt's Analyzer rules version/hash/config is used to fence changes; it is withheld from Strategist/planner prompts while integration is on hold. |

The admission projection intentionally excludes names, contact/home address,
home coordinates, credentials and Shortcut tokens. Do not confuse the Coach's
broader authenticated context with this bounded MAIN projection. `max_deadhead_mi`
is empty travel to collect a rider, not a home radius. Explicit false service
preferences mean avoid; a missing value stays unknown.

Coach `[SAVE_NOTE]` and learned tips use `user_intel_notes` with owner scope and
request/action checks. These notes are not automatic edits to canonical settings.
Feedback/action tables likewise do not establish that preference weights are
self-adjusting. Broader profile learning is not claimed as implemented.

Verification sources: `tests/strategy/main-run-admission.test.js`,
`tests/strategy/legacy-setup-readiness.test.js`, `tests/auth/`,
`tests/strategy/driver-economics-prompt.test.js`, and client setup/profile/auth
lifecycle suites. In-memory PGlite checks transactions/concurrency; mocked providers
check prompt boundaries. No live driver profile, provider or application database
was used to validate these changes.
