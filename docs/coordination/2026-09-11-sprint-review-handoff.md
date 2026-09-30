# September 11 sprint candidate review

## Source and ownership

Melody authorized the 01:19–05:19 UTC implementation session. The reviewed work
lives on isolated branch `astra/offer-faa-review-20260911`, built from Claude's
integrated `74fe5bf9` and preserved main `6a97c058`. Checkpoints `5af254d2`,
`8d0d4822` and `21506372` retain the successive integration stages. The final
commit, cumulative bundle, exact build hashes and running-process mapping are in
the ignored sprint `astra-status.md` and associated manifests; consult those
before integration instead of replaying earlier queued handoffs.

Main and Claude's worktree were preserved. Desktop's transferred patches remain
immutable. Claude's pause was respected; Codex/Astra owned subsequent integration
and the isolated candidate gateway. Nothing was pushed publicly or deployed.

## Result

- Offer outcomes require explicit Save, retain zero and unknown earnings, support
  Other and Edit, preserve drafts through errors and revision conflicts, and keep
  an edited older offer when it leaves the latest-25 list. Full-window decision
  counts distinguish recommendations from recorded driver decisions. Account,
  token, period and delayed-response boundaries are covered by focused checks.
- FAA cards and context retain observed ground stops and restrictions, preserve
  both reasons, distinguish unknown delay minutes from zero, and separate source
  time from retrieval time. Ground stops do not imply whole-airport closure.
- Canonical Coach completion, memo receipts and session boundaries preserve the
  recovered behavior. An actual synthetic request persisted one owned Coach memo;
  a personal-note write was not counted as that result. A separate single TTS
  request produced inspected MP3 bytes without playback or microphone use.
- Briefing generation checks require the persisted complete dependency and fence
  superseded writers. Previous Strategy text stays readable during regeneration
  with its original context and receipt time, while current GPS/error/retry status
  remains visible. History stays passive and separate from current venue actions.
- Venue dismissal, replacement, conflict recovery and Undo operate within the
  owned snapshot/ranking. Modal and dwell state do not transfer to another scope.
  This does not implement the broader personalized scoring policy.
- Event presentation conservatively groups compatible resolved identities while
  retaining source variants and explicit time uncertainty. Missing end times are
  distinguished from disagreement between known end times.
- Settings sections preserve one draft, existing service identifiers, false flags
  and unknown values. Actual saves preserve unrelated stored fields and rulesets.
  Provider admission prevents overlapping same-owner saves across navigation;
  failed or mismatched readback preserves the draft and reports verification limits.
- The production Briefing header no longer displays its snapshot identifier.
- The shared map loader waits for the requested marker API before resolving,
  including an already-present partial Maps namespace. Concurrent callers share
  the script and required imports; failed readiness checks allow a deliberate retry.

## Focused evidence

These are recorded focused results for the corresponding changes, not a full
repository suite or a claim that all existing tests pass. Counts below are kept
by area; some integration coverage overlaps, so they are not a cumulative total.

| Area | Focused evidence |
| --- | --- |
| Offer | 30 UI cases: 24 workflow and 6 session-boundary cases |
| FAA | 47 parser, context, pipeline and card cases |
| Coach | 7 real-router cases with synthetic completion and 34 client cases |
| Previous Strategy | 24 provider/cache, 4 Briefing retry and 7 actual-page cases |
| Venue | 17 hook/modal/cache, 14 actual-page, 17 schema-faithful PGlite and 7 real PostgreSQL cases |
| Briefing concurrency | 5 real PostgreSQL generation/ownership cases with observed lock blocking |
| Settings/auth | 37 Settings, 13 shared authentication and 12 profile-address router cases |
| Event presentation | 17 server and 10 component cases |
| Snapshot badge | Four production-flag static renders per phase: verified-empty, pending, failure and missing snapshot; heading preserved |
| Maps loader | 16 actual-loader cases with synthetic script/import fixtures; two premature-resolution failures reproduced first |

Separate browser receipts exercise real Radix/Recharts and CSS at mobile widths.
The actual candidate Offer, venue and Settings journeys also used authenticated
routes and dedicated disposable PostgreSQL fixtures. The later previous-Strategy
browser journey used synthetic HTTP and resolved GPS, with no writes. These scopes
are explicit in the receipts; health checks establish liveness only.

The sole live memo probe returned one confirmed `COACH_MEMO`, matching one owned
`coach_memos` row and two conversation rows; automatic `user_intel_notes` count
was zero. Captured text re-parsed to one memo action and no other action arrays.
Its authenticated readback checks passed. Provider tool-use history and raw
parent-message linkage were not captured. No second request was made.

## Remaining limits and release prerequisites

The existing rollout todo 79 remains open for the final candidate's release
review. Review the actual target database before release; drain old Briefing
workers before generation-token enforcement and refresh old Offer clients that
lack outcome revisions. The candidate's compatible Coach override does not change
shared or deployed environment configuration. No production migration was run.

History survives the mounted provider, not a cold reload; todo 23's reopen policy
is open. Settings admission is local to a surviving provider, with no cross-tab
ordering or profile/vehicle transaction guarantee. Broader venue learning, taxonomy
and release-readiness tasks remain open.

The bounded public-event query returned no matching concert rows in the configured
development database. It examined only the authorized public fields, with a
read-only transaction and limit 20. Published-site reconciliation is unproven:
the existing UI observation lacks matching row/response IDs or deployment database
attestation. No wider query, private Briefing read or cleanup followed.

Physical microphone recognition, browser audio playback and complete on-device
voice behavior remain unverified in this sprint. Live provider transport evidence
does not establish all tool behavior. A fresh dependency installation remains
unverified because the configured mirror returned 404 for an existing Tailwind
WASI tarball; installed workspace dependencies passed the recorded checks.

The map-loader checks do not establish live Google Maps availability, credentials
or physical GPS. Existing todo 8 also retains a source-level traffic empty-state
concern: a truthy incomplete traffic object can select a reassuring client fallback,
and the page wrapper does not propagate traffic pending/failure markers. No new
traffic implementation or live reproduction was undertaken during final review.

Private fixtures, generated audio and detailed receipts stay outside Git. Used
fixtures must not be reset or replayed. The cumulative Git bundle is preserved in
private Replit storage; a verified Windows copy/export path has not been established.
Keep the candidate runtime and disposable database available for coordinated review.
