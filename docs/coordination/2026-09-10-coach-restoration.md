# Canonical Coach and reported memo restoration

Provenance: Astra Desktop implementation, September 10, 2026, following Melody's
explicit request to restore the main Coach for spoken requests, accept additional
reasoning latency, use supported Astra at its lowest reasoning setting, and make
saved memos visible. Root inspected the signed-in Coach and its existing personal
Notes pane before this implementation. This candidate has not been deployed.

Base: `2269e628`, branch `codex/vecto-coach-restoration-20260910`.
No shared authentication, Offer Analyzer, Briefing generation, package or Jest
configuration edits. Claude's subsequent snapshot/strategy string guards in
`3674a440` affect an unchanged portion of the chat handler and must be retained
when integrating the candidates.

## Resulting behavior

- Typed and spoken requests use the same authenticated Coach endpoint and action
  processor. Normal voice mode uses the existing speech recognition and read-aloud
  controls. Gemini Live no longer decides whether a spoken request reaches the
  canonical Coach. Historical live transport code remains preserved but inactive
  in the normal UI.
- `AI_COACH` defaults to `gpt-6-astra`, `reasoning.effort: low`, through an OpenAI
  Responses adapter. It includes web search, complete supplied message history,
  images and file attachments. Sampling parameters unsupported by this model are
  omitted. No silent replacement with Gemini occurs on provider failure.
- Provider completion is required before executing actions. Interrupted or
  incomplete generation cannot execute action tags from partial text. Saved
  conversation provenance uses the provider's actual returned model identifier.
- Read-aloud waits for final action results. Failed writes replace generated save
  claims with an explicit failure message. Successful memo writes return an ID,
  title, type and creation time receipt. The final cleaned server response avoids
  speaking JSON action envelopes.
- The existing Notes pane now has Personal notes and Reported memos tabs. The new
  list reads only the authenticated driver's `coach_memos`, distinguishes loading,
  empty and failed reads, supports refresh, and reloads after confirmed actions.
  Existing personal-note edits, pins and deletes remain intact.
- The canonical prompt includes the complete saved Briefing row and snapshot,
  including timestamps and generation markers. Missing and read-failed briefings
  are explicit states. The Coach may discuss available history while explaining
  its age and incompleteness.
- Both clients use one incremental SSE parser. It waits for newline boundaries,
  flushes the decoder/final tail at EOF, and cancels/releases the reader. Spoken
  turn finalizers share a synchronous send lock and clear the claimed transcript.
- The provider and retained voice-brain timeout are both 180 seconds. The client
  never substitutes a different brain because the configured provider is slow.

## Verification

Synthetic, serial checks only; no live provider, database or microphone activity:

- `tests/coach/restoration.test.js`: 14 tests covering Responses request shape,
  attachments/history, UTF-8 chunking, completion/error gates, source citations,
  role configuration, memo ownership and receipt failures, full source context.
- `tests/rideshare-coach-validation.test.js`: existing 26 action validation tests.
- `tests/CoachRestoration.test.tsx`: 5 client tests covering confirmed/error text,
  memo loading/empty/error/retry, account-switch late-response isolation, an exact
  JSON-before-newline boundary, and duplicate spoken-turn finalizers.
- Full TypeScript build check and ESLint over every touched application file.
- `git diff --check` and server syntax checks.

An exploratory run included `tests/rideshare-coach-schema.test.js`; Jest rejects
that existing file because it contains no Jest tests. It is a standalone legacy
script. Its wiring was not changed and it is not included in the passing focused
suite. No claim is made that the repository's entire historical suite passes.

## Integration and remaining checks

1. Preserve other agents' authentication and account-isolation patches during
   integration. Do not bring private transcript history into the integration base.
2. Inspect deployed `AI_COACH_MODEL` / `AI_COACH_OVERRIDE_MODEL` settings by name.
   An old Gemini override now fails explicitly; remove it or set the intended
   supported OpenAI model. `OPENAI_API_KEY` must exist in the authorized runtime.
   This implementation did not read, copy or change secret values.
3. Test a synthetic signed-in voice request, interrupted generation, confirmed
   personal note and reported memo, then reload and verify the saved item. Check
   a second account cannot see the first account's records. Verify real search,
   image and file input through the configured provider before release.
4. Inspect the new pane and voice controls in the actual hosted desktop/mobile
   app. Root's desktop observation was the pre-change source. A browser device
   override did not change inner width, so mobile visual verification remains open.

The Coach retains scoped database actions and advisory project context. It gains
no arbitrary filesystem, shell, deployment or browser-control capability.

## API references checked September 10

- [GPT-6 Astra capabilities](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Current model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Responses streaming events](https://developers.openai.com/api/docs/guides/streaming-responses)

These references establish the public contract. A live request with the project's
account was deliberately not performed in this isolated implementation.
