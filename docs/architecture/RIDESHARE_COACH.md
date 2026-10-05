# Rideshare Coach pipeline

Source review: September 29, 2026, on `main` based at `6e983906` plus the current
working changes. This is the canonical source map for Coach. It describes the
repository and synthetic regression results; it is not a deployment, microphone,
provider-availability or live-database certification.

The Coach reduces the driver's need to read or type while driving. Typed and
spoken questions reach the same backend reasoning/action path. The Offer Analyzer
owns offer decisions; Coach explains saved evidence, preferences and strategy.
It must not run a second live offer analyzer or silently change a driver's rules.

## Entry points and ownership

| Entry | Source and responsibility |
|---|---|
| `/co-pilot/coach` | [CoachPage](../../client/src/pages/co-pilot/CoachPage.tsx) obtains authenticated identity and current CoPilot context; [RideshareCoach](../../client/src/components/RideshareCoach.tsx) composes chat, notes, input and audio. |
| `POST /api/chat` | [chat.js](../../server/api/chat/chat.js), authenticated canonical brain and action executor. Body `userId` is not authorization. |
| `GET /api/chat/context/:snapshotId` | Same router, snapshot ownership required. `summary=1` returns source progress and timestamps without a model call. |
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
   synchronously, posts message/history/attachments and snapshot/strategy IDs,
   and fences asynchronous results when identity, snapshot or component changes.
   [useCanonicalVoiceSend](../../client/src/hooks/coach/useCanonicalVoiceSend.ts)
   shares admission for classic microphone input. Live delegation uses
   [askCoachBrain](../../client/src/lib/voice/coachBrain.ts).
2. `POST /api/chat` checks authentication and request shape before writes/provider
   use. Conversation IDs are UUIDs; histories and attachment arrays are validated.
   Snapshot resolution is explicit snapshot ID, then strategy ID resolution, then
   latest snapshot owned by the authenticated user. Supplied IDs pass ownership
   checks before context loads.
3. [RideshareCoachDAL.getCompleteContext](../../server/lib/ai/rideshare-coach-dal.js)
   reads seven snapshot-scoped branches concurrently: snapshot, Strategy,
   Briefing, Smart Blocks, feedback, venue data and actions. Once the snapshot is
   available, it reads owner profile/active primary vehicle, notes, recent offers,
   historical Coach decisions, prior memos/system notes, longitudinal patterns,
   and market intelligence. `getOfferRules` rereads current saved owner rules.
4. `formatContextForPrompt` supplies readable summaries. Snapshot wind retains
   its measured unit; Briefing numeric temperature/wind, display units and zero
   values are preserved. [formatCoachSourceContext](../../server/lib/ai/coach-source-context.js)
   includes complete saved snapshot/Briefing/Strategy/offer/rules/profile/vehicle
   records as data, with explicit provenance and missing/failed-state cautions.
   Strategy is read independently of Briefing; a Briefing read failure must not
   erase saved Strategy. A current Strategy requires its source receipt to match
   the supplied Briefing generation.
5. An owned saved snapshot's timezone supersedes the browser copy. A missing or
   invalid timezone on that saved row returns `TIMEZONE_REQUIRED`. The existing
   no-saved-snapshot branch can use the browser timezone hint, but has no verified
   saved location context. This review did not introduce before-GPS coaching.
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

## Saved Offer Analyzer evidence boundary

Owner offer history is bounded to 20 nonremoved rows; pattern reads cover an
owner-scoped 180-day window. Both can contain legacy evidence. Current owner rules
carry source state (`saved`, `profile_defaults`, `unavailable`, `read_failed`,
`invalid`), version, stored hash, update time, stored schema version and effective
hash/config. Raw stored-hash verification and migrated effective rules are different
receipts. Selected services are choices; eligibility is capability.

The current rules do not prove what produced an older offer. Coach must compare
that offer's receipt, preserve its original Offer Analyzer decision, distinguish driver
outcome from AI evidence, and identify legacy rows whose current decision contract
is unverified. Saved Phase 2 evidence is reread on later turns; Coach does not wait
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
