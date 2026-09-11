# Settings sections and draft preservation — September 11, 2026

## Result and provenance

Settings now uses one parent form with Profile, Location, Vehicle, Services, and
Connections sections. Services groups the existing controls into Ridehail,
Black / premium, and Private / chauffeur views. Vehicle attributes belong in
Vehicle. The service summary retains unrecognized saved platform strings.

This is the bounded preferences UI slice assigned during Melody's September 11
session. The original request is in the preserved September 10 10:01 UTC−6 Astra
capture, lines 3884–3887; the request to inspect the actual UI is at 3983–3984.
The research document `docs/research/RIDE_TYPE_TAXONOMY.md` remains research input.
This change does not complete todo 71 or implement its provider eligibility rules.

## Scope and behavior

- Persisted platform IDs remain `uber`, `lyft`, `ridehail`, and `private`.
  Black / premium is a presentation group for the existing luxury eligibility
  booleans, not a new persisted platform. Attributes and willingness preferences
  retain their existing independent meanings. False flags and unknown saved IDs
  survive section changes and saves.
- Profile or vehicle refreshes adopt new values for untouched fields and preserve
  local edits. A successful save reconciles against the submitted snapshot, so
  edits made while saving, including a revert to the old value, remain pending.
  A failed or thrown save adopts held background refreshes against the previous
  saved baseline and retains the rejected draft for retry.
- The editor is keyed to the authenticated user, refuses a mismatched profile,
  and ignores completion UI from an editor unmounted by an account change.
- Validation opens the appropriate section and focuses text inputs or Select
  triggers. The phone label now labels its input rather than a wrapping div.
  Empty custom-market validation opens Location and focuses the named input.
- During the existing custom-market creation request, that market's name and
  selection are disabled with an explanation. Other fields remain editable.
  This prevents a dependent custom name from disappearing during reconciliation.
- No changes to SignUp, auth context, server/schema, RateTargets, price defaults,
  nullable Comfort/XL rates, provider routing, or classification logic.

## Local branch and integration boundary

- Branch: `codex/vecto-settings-services-20260911`.
- Base: `0a80e83fb677108738ff3269b87dfa0927224e15`, the preserved integrated candidate.
- Worktree: `C:\Users\melod\.codex\worktrees\vecto-settings-services-20260911`.
- Files: `client/src/pages/co-pilot/SettingsPage.tsx`,
  `client/src/lib/settings-draft.ts`, `tests/settings/`, and this handoff.

Compare the patch against the current authoritative Replit branch before applying;
this local base predates the ongoing remote integration. Do not replace newer auth,
venue, Coach, Offer, or FAA work with this worktree. No migration is needed.

## Verification

- Focused Jest suite: 15 tests passed across 2 suites, using the actual Radix tabs,
  Selects, React Hook Form and Settings component with synthetic auth/API fixtures.
  Coverage includes background refresh, delayed save/revert, returned and thrown
  failures, retry payload, account replacement, mismatched profile, unknown IDs,
  false flags, section keyboard navigation and hidden-field validation focus.
- `node node_modules/jest/bin/jest.js --config tests/settings/jest.settings.config.cjs --runInBand`
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.client.json` passed.
- Touched production TS/TSX and test CJS setup/config pass repository ESLint with
  `--max-warnings 0`. The repository ESLint configuration does not match TS/TSX
  under `tests/`; those files are exercised by Jest, not claimed as linted.
- `git diff --check` passed.
- A separate loopback-only synthetic preview loads the actual Settings component
  and CSS with the same background as CoPilotLayout. Root's browser review at
  320 px found no horizontal clipping and confirmed keyboard switching in both
  tab groups. Root also verified a new nickname typed during the delayed save
  remained unsaved after settlement with the explanatory toast, and an invalid
  City reopened Location, focused and scrolled to the visible field error from
  another section. The small screen remains dense but usable. No production data,
  account, provider request, physical permission, or paid call was used.

The standalone `client/tsconfig.json` omits Google Maps types and reports existing
Maps namespace errors; the repository's root `tsconfig.client.json` includes those
types and is the passing client check above. No Maps files were changed.

## Remaining integration checks

Run the focused suite and client check after applying to the authoritative branch.
Verify real profile save/reload retains false selections, private/unknown platform
strings, and unrelated stored rates, and inspect the result in the live app shell.
The account tests establish this component's behavior when supplied auth state
changes correctly; they do not establish the real auth provider's async fencing or
server-side account isolation. Those are separate integration responsibilities.

The temporary preview lives outside Git at
`C:\Users\melod\.codex\tmp\vecto-settings-preview-20260911`, port 5194, with
320/390/1280 px iframe presets and a synthetic delayed save. It is a review fixture,
not an application route or deployment artifact. Parent/root coordinates that
preview's final review and cleanup.


## Replit integration and actual contract verification

Astra applied the checksum-verified Desktop patch to isolated branch
`astra/offer-faa-review-20260911` after checkpoint
`5af254d2e2b318369af43be7d7280f34c1ea5857`, preserving its newer auth and backend
work. Integration exposed four client failures that the original synthetic
provider fixtures did not establish: custom-market creation omitted its required
bearer token; a pre-save background refresh could replace a successfully saved
nickname when the save's own readback failed; and an older profile GET could
replace newer data or sign out a valid session through a late 401.

The bounded fixes authenticate custom-market creation, order profile reads within
the existing session fence, and return the save's own canonical profile/vehicle
readback. Settings confirms only that response or its successfully submitted
snapshot, keeps newer edits, and explains when saved values could not be reloaded.
Unrelated held refreshes still reconcile a failed save without erasing the draft.
The existing profile-to-form mapping was moved unchanged for reuse.

Actual server inspection also found that every full Settings payload triggered
geocoding and automatic market replacement, even for an unchanged address. The
profile route now compares the normalized address values it will actually write
to the stored values. Unchanged and omitted fields skip that work; genuine changes,
including clearing optional address fields, retain the existing geocoding path.
Profile and vehicle writes remain separate; this work does not add transactionality.

Current candidate verification: 22 Settings tests (including seven mounting the
actual AuthProvider), 13 existing auth completion tests, and 12 real-router address
regressions pass. The four client failures were reproduced before the fixes.
Client TypeScript, scoped production lint and the candidate build pass. Mocked
router checks establish that real address changes still call geocoding while
unchanged saves do not; no geocoding provider was called in these tests.

The isolated candidate gateway then accepted two real profile PUTs for a new
synthetic driver in the existing disposable PostgreSQL database. A held successful
response allowed a later nickname edit; it stayed visibly unsaved, and the second
save followed by a full reload retained that edit, added Lyft, and enabled luxury
sedan eligibility. Existing private/unknown service strings, false flags, unchanged
address and vehicle fields survived. Those fixtures are now used and must not be
reset or replayed. Canonical SQL preservation and final mobile layout receipts are
recorded separately in the ignored sprint coordination artifacts, not in Git.

This is candidate-only evidence. No production account, migration, publication,
rate/eligibility redesign, live connection authorization, or physical location/audio
check is claimed. The broader Settings taxonomy todo remains open.

## Provider lifetime and failed readback follow-up

Desktop identified a reachable overlap after `8d0d4822`: save A, navigate away,
remount Settings under the same AuthProvider, then save B before A completes.
Deferred PUT regressions reproduced an older server write landing last despite
the editor's response fencing. The provider now admits one save per owner through
its PUT and canonical readback. A second editor receives a retry explanation and
keeps its draft. The guard survives same-owner token replacement; a different owner
can save independently. Only the original request releases its own admission.

Additional regressions reproduced successful PUTs followed by a 503, foreign-owner
response, inconsistent profile or missing profile clearing or replacing the editor.
Readback now validates user/profile/vehicle identity and the captured expected
owner before publishing. Only a current 401 expires authentication. Other failures
preserve the current draft and report that saved values could not be reloaded.
Malformed JSON, old-token 401, and a newer login during logout remain covered.

All 37 Settings tests and 13 shared authentication tests pass after this follow-up.
These checks mount the actual provider and editor with controlled HTTP responses;
they do not replay the already-used PostgreSQL browser fixtures. Earlier SQL
readback separately proved preservation of unrelated profile, vehicle and complete
ruleset rows, including nullable rates and timestamps. Final read-only browser
receipts also passed at 320/390 px with keyboard section switching and no new PUTs.

Admission is scoped to a surviving provider. It does not establish cross-tab or
server-wide ordering, and a lost transport response cannot prove whether an old
server write eventually committed. Profile and vehicle writes remain separate.
