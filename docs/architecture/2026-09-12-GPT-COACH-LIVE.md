# GPT Coach and conversational voice — 2026-09-12

Status: implemented in the private must-haves candidate; isolated Replit preview
running on port 5199 against the preserved disposable review database on 55432.
Main on port 5000 remains the earlier runtime.

Melody requested the best GPT Coach with its live voice on September 12. The
existing schema, saved offer gates, canonical action receipts, and fresh data
requirements remain the product contract.

## Decision

Use `AI_COACH=gpt-6-astra` through the existing Responses adapter, retaining low
reasoning effort for conversational latency. The complete persisted source
context and web search stay on this canonical backend for typed and spoken work.
Use a separate `COACH_VOICE_OPENAI_LIVE=gpt-live-1` role, default voice Marin, with
client delegation to that backend. A text-brain service override does not apply
to live voice roles. An incompatible explicit GPT-Live pin fails visibly.

GPT-Live is a different protocol from Realtime. Its WebRTC offer travels through
authenticated `/api/coach-live/session`; the server verifies supplied snapshot
ownership before creating a paid session. Session configuration and project keys
remain server-side. The response allowlist contains only model, session ID and SDP.
There is no automatic switch to another model after an error.

## Interaction and evidence boundaries

- Start voice is an explicit user action. Snapshot completion never opens a mic.
  Pause disables the local track immediately. End stops capture and playback
  immediately, while briefly retaining the control channel for finalization.
- GPT-Live sends timed transcript fragments, without authoritative completed-turn
  events. Preserve original words and offsets, allow overlapping speakers, and
  label the display as automatic captions. A caption is not a playback receipt.
- Only `session.delegation.created` initiates a backend request. Transcript
  grouping does not execute tools. Delegation IDs are deduplicated; work is
  serialized. Live can delegate before the driver finishes a sentence. If more
  speech arrives during a check, reconcile the same task using the latest
  fragments and its earlier result. Follow-ups are answer-only: the server
  blocks action tags and automatic tip extraction, while keeping conversation
  history. They have a 30-second deadline and are limited to two reconciliations;
  continued changes then produce an audible clarification instead of silence.
  A speech interruption cannot prove a previously submitted write canceled.
- The existing `/api/chat` completion checks and saved-action receipts apply.
  The offer analyzer remains the only component that decides accept/reject.
- Persist fragments as JSON text with `voice_transcript_fragment` provenance in
  the existing conversation content column. No table or column changes are made.
- The Coach route can remain available when data is incomplete or failed.
  Strategy stays blocked and the Coach shows the limitation. Authentication
  failures still block the route.
- Separate OpenAI voice preferences prevent old Gemini voice names breaking a
  new connection. Changing voice while paused preserves the pause.
- Provider-initiated End also stops the browser wake listener and aborts the
  pending Coach request. Session ownership guards prevent late events, startup
  failures and wake callbacks from changing a replacement session.
- A transient WebRTC disconnect gets five seconds to recover on the existing
  connection, preserving Pause. Persistent loss ends capture; it never creates
  another paid session automatically. Negotiation has a 35-second client deadline
  covering both headers and body, in addition to the server's upstream deadline.

## Strategy time labels

Show persisted Strategy `updated_at` as “Strategy updated” and the snapshot's
`created_at` as “Data as of,” rendered in the GPS-resolved timezone. A retrieval
time is not a generation time. Current Strategy cannot display without valid
source timestamps; the server returns an explicit retry state for missing times.
Existing history keeps its original receipt time and separately retains source
timestamps. No browser-timezone or current-time substitute is used.

## Verification and limits

The development key's model list includes GPT-6 Astra and GPT-Live 1. Claude's
synthetic Responses request returned HTTP 200 and model `gpt-6-astra` (14 tokens).
Desktop's GPT-Live WebSocket probe at 2026-09-12T13:17:34.939Z received
`session.started`, model `gpt-live-1`, 65,280 audio bytes, transcript `Hello.`, and
`session.closed` with one second of final usage. This used synthetic silence,
Marin, no microphone and no driver data. An earlier probe closed before its
instruction finished and recorded `context_injection_incomplete`; both receipts
are retained in Replit's private coordination directory.

Automated tests cover auth before billing, payload and provider-error handling,
voice preference isolation, late microphone permission, start-event readiness,
delegation deduplication, correction handling, pause/end, Unicode append bounds,
and exact transcript fragments. Existing canonical Coach action tests remain in
the verification set. The candidate's real HTTP checks returned login 200,
unauthenticated voice 401, invalid voice payload 400, and unknown snapshot 404.
An actual `/api/chat` request with an explicitly synthetic persisted snapshot
returned HTTP 200, `Coach ready.`, and a completed SSE response without errors.
Its saved assistant row records `model_used=gpt-6-astra`. The source fixture is
labeled synthetic; it is not observed GPS, weather, or air-quality evidence.
The separate candidate sign-in page loaded in the browser.

Actual browser WebRTC was exercised through a loopback fixture using the real
candidate endpoint and real session class, with generated silence and muted
output. It returned 201, reached live in about 2.2 seconds, and generated greeting
captions. A second run confirmed `session.input_audio.muted`, `unmuted`,
`session.commentary.appended`, greeting captions, stopped synthetic capture,
and `session.closed` with 30 seconds final usage.

A third run used an offline-generated spoken question. It proved transcription,
client delegation, and the real GPT Coach response, but exposed an early-delegation
bug: the sentence's final clause caused the old revision guard to withhold the
answer indefinitely. Its failing receipts are preserved. The answer-only
reconciliation above corrects that implementation. The fourth live run passed:
the actual candidate returned voice session 201 at 14:07:27.224 UTC, two Coach
responses returned 200, the follow-up was recorded as `answerOnly: true`, and
`session.commentary.appended` arrived at 14:07:52.807. Captions said, "Thanks for
waiting. The latest records I have still show no briefing or strategy available."
That is correct for the explicitly synthetic fixture, which has neither saved.
Capture stopped locally with `tracksStopped: 1`; `session.closed` at 14:08:12.069
reported 43 seconds final usage. The loopback server was subsequently stopped.
Original receipts for all four runs remain in `test-results/gpt-live-browser`.

Claude's bounded read-only reconciliation review confirmed server-side action
and automatic-learning guards. Malformed delegation offsets now receive an
audible clarification directive rather than silence; unit regressions cover
missing, negative and nonfinite offsets. The existing receipt guard intentionally
replaces model prose with a save-failure message if an answer-only response emits
action tags: retaining that prose could repeat an unconfirmed success claim.
Earlier completed answers remain in written history even when reconciliation
changes the spoken result. The initial call can still execute an explicitly
requested action before later speech arrives; reconciliation is not rollback.

Physical-phone WebRTC, audible quality and Bluetooth/speaker routing still require
separate verification. No live microphone was used for these provider checks.
Initial serialized delegations retain the existing 180-second backend request
ceiling; a slow request can delay another. Append
acknowledgments are tracked but are not a playback receipt or retry mechanism.
These limits must not be described as verified phone behavior.

Main is still the earlier runtime until candidate review is completed. Its Gemini
transport must not receive a GPT model pin. Candidate launch configuration must
explicitly override the inherited Gemini Coach pins after loading its private env.

## Sources checked September 12

- [GPT-6 Astra migration](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart)
- [GPT-Live model](https://developers.openai.com/api/docs/models/gpt-live-1)
- [GPT-Live migration](https://developers.openai.com/api/docs/guides/live-migration)
- [Client delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [Voice options, captions and session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations)
- [WebRTC connection](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [W3C WebRTC transport states](https://www.w3.org/TR/webrtc/#dom-rtcicetransportstate)

At the checked rate, GPT-Live voice duration is $0.05/minute, billed by second;
the configured backend model and tools are billed separately. Closing the session
ends its live connection; microphone pause alone keeps the session running.
