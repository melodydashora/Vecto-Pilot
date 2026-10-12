# Rideshare Coach pipeline

Source review: September 29, 2026, on `main` based at `6e983906` plus the current
working changes. This is the canonical source map for Coach. It describes the
repository and synthetic regression results; it is not a deployment, microphone,
provider-availability or live-database certification.

October 12 source update: the settings action, independent Coach snapshot and
client receipt paths below implement Melody's requested behavior. This is a repository contract; the
historical test counts at the end remain scoped to their dated review.

The Coach reduces the driver's need to read or type while driving. Typed and
spoken questions reach the same backend reasoning/action path. The Offer Analyzer
owns offer decisions; Coach explains recent analysis evidence, preferences and strategy,
and can adjust Offer Analyzer controls when the driver asks. A request to review
recent offers and tune settings lets Coach choose supported values and explain the
tradeoffs. Advice or an offer review alone does not authorize a settings change.
Coach must not run a second live offer analyzer or silently tune between turns.

## Entry points and ownership

Coach can discuss its current observation, original Briefing and Strategy sources,
events and venue recommendations; review recent quick/deep offer evidence and
reported outcomes; explain or tune current Offer Analyzer settings on request;
maintain driver notes, market/venue intelligence and event corrections; and record
bug reports, feature ideas and test requests as memos. Its web search can verify
current incidents and destination facts. A memo requesting tests records the
request; the production chat has no shell or application test-runner tool.

| Entry | Source and responsibility |
|---|---|
| `/co-pilot/coach` | [CoachPage](../../client/src/pages/co-pilot/CoachPage.tsx) obtains authenticated identity and current CoPilot context; [RideshareCoach](../../client/src/components/RideshareCoach.tsx) composes chat, notes, input and audio. |
| `POST /api/chat` | [chat.js](../../server/api/chat/chat.js), authenticated canonical brain and action executor. Body `userId` is not authorization. |
| `GET /api/chat/context/:snapshotId` | Same router, snapshot ownership required. `summary=1` returns source progress and timestamps without a model call. |
| `GET/POST /api/coach/snapshot` | [Independent capture](../../server/lib/location/coach-snapshot.js), authenticated current-session GPS and Google observation. It does not change MAIN pointers or generate Briefing/Strategy. |
| `POST /api/chat/voice-turns` | Same router, authenticated capture of live transcripts; validates bounded turns and snapshot ownership. |
| `/api/coach/{notes,memos,schema,validate}` | [rideshare-coach/index.js](../../server/api/rideshare-coach/index.js) mounts authenticated note CRUD, memo receipts, schema metadata and validation. |
| `/api/coach-live/session` | [coach-live.js](../../server/api/chat/coach-live.js), GPT-Live WebRTC setup. |
| `/api/realtime/token`, `/api/gemini-live/token` | [realtime.js](../../server/api/chat/realtime.js), [gemini-live.js](../../server/api/chat/gemini-live.js), retained selectable live voice transports. |
| `/api/tts` | [tts.js](../../server/api/chat/tts.js) → [tts-handler.js](../../server/lib/external/tts-handler.js), authenticated speech synthesis. |

[bootstrap/routes.js](../../server/bootstrap/routes.js) establishes mounts.
`chat-context.js` exists on disk but is not mounted by this registry; it is not the
current client progress endpoint. `/api/chat/send` remains a legacy client constant,
not the mounted canonical chat handler. The `/api/chat/notes` routes and richer
`/api/coach/notes` CRUD coexist; the notes UI uses the latter. They are separate
entry points, not two executors for one generated action.

## Typed or delegated question: full trace

1. [useCoachChat](../../client/src/hooks/coach/useCoachChat.ts) admits one request
   synchronously, posts message/history/attachments, saved source snapshot/strategy IDs and a separate `coachSnapshotId`,
   and fences asynchronous results when identity, snapshot or component changes.
   [useCanonicalVoiceSend](../../client/src/hooks/coach/useCanonicalVoiceSend.ts)
   shares admission for classic microphone input. Live delegation uses
   [askCoachBrain](../../client/src/lib/voice/coachBrain.ts).
2. `POST /api/chat` checks authentication and request shape before writes/provider
   use. Conversation IDs are UUIDs; histories and attachment arrays are validated.
   Saved source resolution is explicit snapshot ID, then strategy ID resolution.
   Without an independent Coach observation, the legacy fallback selects the latest
   owned non-Coach snapshot. An explicit Coach ID is verified separately for owner,
   live session, purpose and complete source receipts; rejected IDs never fall back.
3. [RideshareCoachDAL.getCompleteContext](../../server/lib/ai/rideshare-coach-dal.js)
   reads saved source branches concurrently: snapshot, Strategy, Briefing, Smart
   Blocks, feedback, venue data and actions. A verified independent Coach row
   supplies current location/time/weather/air; saved guidance retains its original
   ID and source snapshot. Once location is available, it reads owner profile/active primary vehicle, notes, recent offers,
   historical Coach decisions, prior memos/system notes, longitudinal patterns,
   and market intelligence for the current Coach city. `getOfferRules` rereads current saved owner rules.
4. `formatContextForPrompt` supplies readable summaries. Snapshot wind retains
   its measured unit; Briefing numeric temperature/wind, display units and zero
   values are preserved. [formatCoachSourceContext](../../server/lib/ai/coach-source-context.js)
   includes complete saved snapshot/Briefing/Strategy/offer/rules/profile/vehicle
   records as data, with explicit provenance and missing/failed-state cautions.
   `source_snapshot` and `saved_context_source` identify older guidance separately;
   different-city data and old route distances do not establish current conditions.
   Strategy is read independently of Briefing; a Briefing read failure must not
   erase saved Strategy. A current Strategy requires its source receipt to match
   the supplied Briefing generation.
5. An owned saved snapshot's timezone supersedes the browser copy. A missing or
   invalid timezone on that saved row returns `TIMEZONE_REQUIRED`. The existing
   no-saved-snapshot legacy branch can use the browser timezone hint, but has no
   verified saved location context. A failed independent Coach context read cannot
   use that fallback or client-supplied Strategy.
6. The route adds snapshot history, zone intelligence and applicable operator
   context, saves the user's message, and builds the prompt plus conversation
   history. These history writes are awaited and failures are reported.
7. [callModelStream](../../server/lib/ai/adapters/index.js) routes `AI_COACH` to
   [coach-responses.js](../../server/lib/ai/adapters/coach-responses.js), the OpenAI
   Responses transport with web search, attachments and a bounded timeout.
   The [model registry](../../server/lib/ai/model-registry.js) pins the actual
   brain and voice roles; no role pins changed during this review.
8. `readCoachResponse` streams deltas and requires a completed provider response.
   Incomplete, failed, truncated and empty responses cannot execute actions.
   [parse-actions.js](../../server/api/chat/parse-actions.js) extracts supported
   action tags and reports malformed JSON; [validate.js](../../server/api/rideshare-coach/validate.js)
   validates each action before the DAL write.
9. `executeActions` awaits writes and checks their results. Parse/write failures
   become explicit not-saved text in the final response and persisted history.
   Automatic tip extraction is skipped for answer-only turns and explicit
   `SAVE_NOTE` turns; otherwise it counts only confirmed inserts.
10. Assistant history is saved, then the SSE `done` payload carries confirmed
    `response_text`, `conversation_id`, action results/memo receipts and any
    persistence error. [readCoachEvents](../../client/src/utils/coach/readCoachEvents.ts)
    and [confirmedReply](../../client/src/utils/coach/confirmedReply.ts) reject
    incomplete success. Action refresh/confirmation and speech use the completed
    result, not an early streamed claim that something was saved.

Disconnect cancellation spans context loading through completion. No later action,
learning insert or assistant-history write begins after cancellation is observed.
A database write already in flight may complete; cancellation is not transaction
rollback and callers must check saved receipts before retrying an uncertain action.
The close listener is removed in the route's final cleanup.

<a id="saved-analyzer-evidence-boundary"></a>

## Recent Offer Analyzer evidence boundary

Recent offer context is bounded to 20 nonremoved owner records by observation
time; this is not the separate **Saved Offers** feature Melody named. Current
source stores quick and deep evidence together in `offer_intelligence`:
`parsed_data_json.phase1_result` retains quick evidence, while the remaining
parsed/raw analysis and `deep_decision` retain deep evidence. Coach reads both.
The window orders valid numeric `request_at` before row completion time; invalid
or legacy observation receipts fall back to `created_at` with explicit provenance.
The existing async pipeline inserts after deep processing, so an in-flight quick
result may not be present yet. This change does not redesign that ingestion.

Each recent offer includes its separate owner-matched `offer_outcomes` row with
revision, reported status and money fields, or null when unknown. `ACCEPT` and
driver-reported `Accepted` do not establish an active trip. Coach may ask whether
the driver took or is on the last ride. Passenger names are usable only when
explicitly present in raw evidence or supplied by the driver; current storage has
no guaranteed structured name field. A missing outcome and unreported earnings
remain unknown. Coach currently has no action to save a separate offer bookmark
or write an outcome; existing outcome controls remain in Offer Analyzer. The exact
current storage/UI mapping for the separately named Saved Offers feature has not
been verified, and this work does not invent it.
The [dated record](removals/2026-10-12-coach-recent-offer-context.md) preserves the
earlier query, presentation and terminology.

Pattern reads cover an owner-scoped 180-day window. Both recent records and patterns
can contain legacy evidence. Current owner rules
carry source state (`saved`, `profile_defaults`, `unavailable`, `read_failed`,
`invalid`), version, stored hash, update time, stored schema version and effective
hash/config. Raw stored-hash verification and migrated effective rules are different
receipts. Selected services are choices; eligibility is capability.

The current rules do not prove what produced an older offer. Coach must compare
that offer's receipt, preserve its original Offer Analyzer decision, distinguish driver
outcome from AI evidence, and identify legacy rows whose current decision contract
is unverified. Recorded Phase 2 evidence is reread on later turns; Coach does not wait
for the MAIN Strategy pipeline to finish to discuss available saved information.

Architecture documents and registry source text are not runtime Offer Analyzer rules.
`LOG_OFFER_DECISION`, `UPDATE_OFFER_DECISION` and `BACKFILL_OFFER_INTEL` tags are
recognized only to return explicit not-saved errors; their mutations are retired.
Driver outcome and override controls remain in the Offer Analyzer API/UI. Coach changes
here do not send Offer Analyzer records into MAIN Snapshot, Briefing, Strategist or Venue
Planner prompts. See [Offer Analyzer](OFFER_ANALYZER.md#15-coach-integration).

## Supported actions and durable evidence

| Tags | Write destination |
|---|---|
| `SAVE_NOTE` | `user_intel_notes` |
| `DEACTIVATE_EVENT`, `REACTIVATE_EVENT`, `ADD_EVENT`, `UPDATE_EVENT` | `discovered_events` through validated DAL methods |
| `DEACTIVATE_NEWS` | Owner-scoped `news_deactivations` |
| `SYSTEM_NOTE` | `coach_system_notes` |
| `ZONE_INTEL`, `MARKET_INTEL`, `SAVE_VENUE_INTEL` | `zone_intelligence`, `market_intelligence`, `venue_catalog` |
| `COACH_MEMO` | `coach_memos` primary receipt, plus a best-effort workspace inbox append |
| `UPDATE_OFFER_RULES` | Owner's existing `offer_rulesets` row through the same canonical writer as the Offer Analyzer editor |
| `REFRESH_COACH_SNAPSHOT` | No server action write: requests one client GPS/Google capture after a completed response |

### Independent Coach snapshot

Activating Coach attempts one fresh device capture. Later, the driver can refresh
it or Coach can request a refresh when the driver has moved or a question needs
new location evidence. The existing deterministic collector supplies GPS, Google
geocoding/timezone/weather/air and source receipts. Each completed observation is
an immutable `snapshots` row with `permissions.context_kind = 'coach'`, bound to
the current authenticated user and session. No schema change, MAIN admission,
MAIN pointer replacement, Briefing generation or Strategy generation is involved.

`coachSnapshotId` is separate from the existing conversation/saved-source
`snapshotId`. New observation IDs do not reset the conversation. Current Coach
geography drives market lookup and the clock; saved Briefing, Strategy, Schools
and destinations retain their original geography, IDs, generation receipts and
timestamps. Schools dates are classified using the current Coach local date,
with an explicit geography-match field; old-city calendars do not prove nearby
closures. Progress timestamps carry each source's own timezone. The observation
time is the GPS receipt, not the time the UI read it.

`REFRESH_COACH_SNAPSHOT` accepts only one nonempty reason, with no coordinates.
A completed non-answer-only turn returns
`actions_result.coach_snapshot_refresh = { requested: true, reason }` and does not
increment the saved-action count. Interrupted, invalid and answer-only requests
cannot trigger capture. The model must describe the pending request honestly;
only the later device/provider receipt establishes a refreshed observation.

After a successful model-requested capture, one bounded answer-only continuation
answers the original question using the new Coach ID. It may use web search for
current accident or destination evidence; GPS/weather alone do not verify an
incident. It cannot request another refresh or replay writes. Capture failure
remains visible and does not start that continuation. This never enters MAIN.
See the [preserved prior contract](removals/2026-10-12-coach-snapshot-context.md).

### User-directed Offer Analyzer tuning

Typed chat and delegated voice use the same `UPDATE_OFFER_RULES` action with a
reason and bounded list of named control changes. The
[control patcher](../../server/lib/offers/coach-rules-patch.js) accepts the existing
toggles, slider ranges and existing avoided-place controls. It preserves unrelated
settings, uses the editor's switch-on defaults, and derives a tier's acceptance
rule when that tier is edited. New avoided places still require the Places picker;
Coach cannot invent their identity or coordinates. This action does not modify
service selection, model settings, historical offer decisions or driver outcomes.

The [shared rules writer](../../server/lib/offers/ruleset-writer.js) validates the
complete effective config against the existing v3 rules schema, under the current
authenticated driver's settings/session lock. The rules version and hash come
from server-loaded context for that turn. A changed version, unverifiable rules,
invalid control or stale session fails without an automatic overwrite or retry.
No new database table or stored rules schema is introduced.

After commit, the action result supplies the saved version/hash and actual
before/after changes. A verified no-op is reported separately. A generated claim
that settings were saved is not a receipt. Failed actions, incomplete responses
and answer-only voice reconciliation cannot count as successful updates. Every
new tokened Offer Analyzer request reads current committed rules from the database.
There is no 15-second instance cache delay after a save. An analysis already in
flight keeps the rules and provenance it captured; a later save does not rewrite it.

The client displays the confirmed result before refreshing canonical saved setup.
Unsaved editor drafts remain intact, and a previous Strategy cannot silently adopt
the new settings. Valid saved preferences do not require a routine confirmation
popup; missing settings, dirty drafts and failed readback remain real gates.
Starting Strategy remains an explicit driver action. The settings action does not
start a run or trigger another offer analysis.

Replaced wording and the obsolete page-relocation comment are preserved in the
[dated removal record](removals/2026-10-12-coach-offer-analyzer-tuning.md).

### Destination links in chat

When Coach recommends where to go, **Directions** is the primary link. Saved Smart
Block coordinates and place IDs feed a deterministic directions URL in
`navigation_context`; a catalog address joins only by the same saved place ID.
Other recommendations require a known saved destination or a search-verified
address. Missing evidence must not become invented coordinates or an address.

The URL uses Google Maps' directions action, driving mode and navigation request;
the device may open navigation or a route preview. A place-search link is not a
directions link. See [Google's Maps URL contract](https://developers.google.com/maps/documentation/urls/get-started#directions).
Venue websites are supplied only when requested, while research citations remain
separate **Source** links. The chat renderer supports HTTP(S) link labels and
corrects a website mislabeled Directions without changing its destination.
Venue-card navigation is outside this chat correction.
The [removal record](removals/2026-10-12-coach-navigation-links.md) preserves the
previous search-link instruction and plain-URL renderer.

The current `AI_COACH` registry configuration uses HIGH reasoning and a
16,384-token output allowance, at Melody's October 12 direction. This describes
configured source behavior; provider completion and actual response latency
require their own request receipts.

[saveMemoWithReceipt](../../server/api/rideshare-coach/memos.js) requires a returned
row with the receipt fields before reporting success. The inbox append is not the
primary persistence claim. `saveCoachMemo` currently sets deployment rows to `new`
and workspace rows to `exported`; a failed workspace append can therefore require
manual recovery from its confirmed DB row. This review did not change that status
policy or treat a filesystem append as proof of a DB save.

[The memo export runbook](../COACH_RUNBOOK.md) describes the corrected operator
script, supplied database selector, concurrency lock and retry receipts. Do not
copy driver conversations or private memo contents into Git documentation.

## Voice and speech lifecycle

[useVoiceSession](../../client/src/hooks/coach/useVoiceSession.ts) owns the voice
engine, wake listener, session epoch, brain cancellation, transcript queue and
conversation ID. A session retains the credential/snapshot that owns its captured
transcripts. Account change/unmount ends capture; late callbacks cannot append to
a replacement account. Flushes use the original credential and may be refused if
that session was revoked. They never relabel old words under a new credential.

| Mode | Path and boundaries |
|---|---|
| Classic | Browser speech recognition → canonical chat → `useTTS`. Driver voice admission and confirmed completion control speech. |
| GPT-Live | [GptLiveSession](../../client/src/lib/voice/GptLiveSession.ts) → `/api/coach-live/session`; transcript fragments and delegated requests go to the canonical brain. Continuation reconciliation sets `answerOnly` to prevent duplicate actions/learning. |
| Gemini Live | [GeminiLiveSession](../../client/src/lib/voice/GeminiLiveSession.ts) → `/api/gemini-live/token` → Google Live session; backend questions use `askCoachBrain`. |
| OpenAI Realtime | [RealtimeSession](../../client/src/lib/voice/RealtimeSession.ts) → `/api/realtime/token` → WebRTC; backend questions use `askCoachBrain`. |

Live connection handlers authenticate and verify supplied snapshot ownership
before minting. Legacy token handlers validate identifiers, use authenticated
identity, mark credentials `no-store`, bound requests and propagate disconnect.
A malformed successful OpenAI response without a credential is an upstream failure.
Gemini mint passes the signal to the installed SDK and restores the Maps key even
if SDK construction fails. Cancellation cannot promise reversal of provider usage
already accepted upstream.

Transcript fragments are not proof of completed audio playback. GPT-Live stores
`voice_transcript_fragment`; retained engines store `voice_transcript`. Brain
messages are separate records with their own provenance. The queue is bounded and
best effort, with no retry that could disturb the active voice session.

`askCoachBrain` checks cancellation before requests, completions and callbacks,
and releases its parent abort listener after each turn. Stop aborts pending token
and SDP requests; late microphone permission cannot restart capture. Provider-ended
sessions stop wake listening and brain work. TTS generation cancellation reaches
the SDK; stale audio callbacks/pollers cannot restart browser fallback speech or
mark a replacement utterance idle. Already-authorized classic TTS may continue
across ordinary page navigation, preserving Melody's existing preference; explicit
Stop and account replacement end the old audio ownership.

## Review evidence and limits

September 29 regressions cover saved timezone precedence; malformed chat shape;
post-disconnect actions and learning; exact weather units/zero values; voice account
switch/unmount; late mic permission/mint; stale TTS callbacks; provider mint validation
and cancellation; Gemini constructor restoration; and memo export concurrency/retry.
The complete Coach backend suite plus dedicated SDK/export tests passed (203 tests
across 13 suites); eight client suites passed (51 tests). Sources:
[tests/coach](../../tests/coach), [client integration](../../tests/client/coach-integration.test.tsx),
[voice lifecycle](../../tests/client/coach-voice-lifecycle.test.tsx),
[audio cancellation](../../tests/client/coach-audio-cancellation.test.tsx),
[brain cancellation](../../tests/client/coach-brain-cancellation.test.tsx).

These use synthetic provider, hardware, filesystem and database fixtures. This
review did not run the gateway, migrations, paid provider requests, an application
DB write, deployment or live driving/audio acceptance. Historical audit counts and
old model descriptions were removed rather than presented as today's facts.
[Removal receipt](removals/2026-09-29-coach-doc-consolidation.md).
