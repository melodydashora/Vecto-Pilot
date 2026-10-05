# Offer Analyzer on Android

Feature names follow the [canonical lexicon](../../LEXICON.md): **Offer Analyzer**
analyzes and tracks **offers**.

> Repository-source review: 2026-09-29. Current setup is a signed-in browser capture
> flow with an optional HTTP Shortcuts **browser launcher** download. This document
> separates it from historical direct-upload automation. No current device import,
> capture-to-speech timing or production rollout is certified here.

## Part 1 · Current browser setup

1. Sign in to your deployment, open **Offer Analyzer → Phone Setup**, and review
   selected services and saved rules. Keeping the saved choices is valid.
2. Choose **Open Offer Analyzer capture**. In Chrome, use **Add to Home screen** or the
   install option if offered while `/co-pilot/analyze` is selected.
3. Configure and test while stopped. Open the icon, choose a current JPEG, PNG or
   WebP screenshot no larger than 5 MiB, allow precise location and hear the result.
4. A result requires personal-rule verification, a current timestamp and matching
   decision/speech. The page expires it after 30 seconds. Audio errors are visible;
   **Speak result** is available while the result is current.

This flow needs screenshot selection. It cannot silently capture another app or accept
an offer for you. Sources: `QuickAnalyzePage.tsx`, `offer-capture.ts`, `SetupCard.tsx`.

## Part 2 · Optional downloaded Android launcher

SetupCard generates `Vecto-Android-launcher.json`. If using HTTP Shortcuts, import it
with the normal **Import / Export** action, preserving existing shortcuts, then add
**Offer Analyzer** to the home screen. It opens the same deployment’s browser page;
sign-in and screenshot selection still occur there.

`client/src/lib/android-launcher.ts` exports a `browser` shortcut using schema version
91 / compatibility 90. It contains no personal token, driver ID, coordinates or script.
It uses the current deployment origin and rejects insecure non-loopback/account-bearing
origins. This is a source-contract description, not a claim that every installed
HTTP Shortcuts version has been tested.

The [September 11 source review](MOBILE_CONCIERGE_2026-09-11.md#android-launcher-artifact-and-native-upload-boundary)
records the official version inspected, tests and unverified physical-phone boundary.
The earlier native GPS uploader was not shipped because its inspected API did not
expose the actual fix timestamp needed by that proposed capture contract.

## Part 3 · Existing direct-upload automation

The server also accepts legacy configured automation without browser JWT auth:

| Input | Request |
|---|---|
| OCR text | JSON or URL-encoded body with `text`, `source=android_text`. |
| Screenshot | Multipart File part named `image`, or base64 JSON. |
| Raw screenshot | Body is image bytes with `image/*` or `application/octet-stream`; metadata such as `source=android_vision` goes in query parameters. |

Use the exact same-deployment hook URL shown in SetupCard and the owner’s
`X-Shortcut-Token` header. `device_id` and `shortcut_system` are telemetry, not credentials.
Do not export a personal macro with its token. A distributable must be scrubbed and
newly configured by its owner.

The historical direct-upload recipes omit GPS; later enrichment resolves trusted card
locations/timezone where possible. That is distinct from current browser GPS validation.
Text and vision both enter Phase 1. A screenshot input is not a synonym for Phase 2.
Older HTTP Shortcuts/Tasker menu recipes and prices are retained only in the historical
version referenced by the removal ledger, not asserted as current product instructions.

## Part 4 · MacroDroid field-tested lessons (August 2026)

Melody’s Samsung text lane was field-tested in the August 17/18 session. The August
intake captured the following load-bearing facts; they remain useful when rebuilding
that specific automation, without certifying a new device/version:

1. Capture/read the **current** screen into OCR array `ocr_arr`.
2. At runtime, **Set Variable** dictionary `req.text` from that array before outputting
   JSON. A dictionary template alone did not resolve the magic text at output time.
3. Use the magic-text picker’s **Standard Format** in the tested workflow. The server
   accepts the `[0]: … [1]: …` array representation; no joining step is required.
4. **JSON Output** must follow variable assignment. The HTTP request must follow JSON
   output. Reversing that order sent the previous offer during the field test.
5. Wait for the HTTP response; parse that response, show `notification`, and speak
   `voice`. On failure say the check failed; do not speak the previous result.

The tested screen-capture permission needed **Entire screen**; the single-app grant
produced blank OCR. Samsung battery restrictions also interrupted automation. Preserve
those diagnostic observations without assuming every empty OCR is a secure-screen block
or promising another capture mechanism will bypass it.

The historical vision variant used **Content Body: File** to send screenshot bytes,
with `source`, device label and `shortcut_system` in query parameters and the token in
the header. A saved-file test does not establish that the current live screenshot is
being captured. Delivery cards need their distinct economics; Melody’s August workflow
used screenshot evidence for them.

See [the August incident/intake](../review-queue/PLAN_intake-2026-08-26-offer-analyzer-handoffs.md)
for chronology and [the removal ledger](removals/2026-09-29-offer-analyzer-doc-reconciliation.md)
for the exact prior recipe. No historical latency is a current service promise.

## Part 5 · Test and troubleshoot

While stopped, verify current offer capture, selected service, pickup/trip distinction,
chosen rate basis, personal rules, speech, errors and history. Measure the entire
capture-to-speech interval. Check a non-offer image and a delayed response too.

| Symptom | Check |
|---|---|
| Previous offer analyzed | Variable assignment → JSON output → HTTP order; current file rather than an old saved screenshot. |
| Empty OCR | Capture permission and actual current screen; app/phone restrictions need device diagnosis. |
| Token/rules failure | Token from the same deployment; unknown supplied tokens fail closed. |
| 413 response | Body/file exceeds 5 MiB; handle the returned manual-decision response. |
| Speech absent | Actual parsed `voice`, phone/browser audio and visible error path. |
| Result appears but no history row | Phase 2/storage may fail after speech, and unresolved trusted timezone prevents storage. |

## Part 6 · Maintainer reference

[Canonical Analyzer contract](OFFER_ANALYZER.md) covers transport, rules, decision
provenance, storage and outcomes. [Roadmap](OFFER_ANALYZER_ROADMAP.md) separates current
code from device gates and future native integration. Do not mark the browser launcher
as certified cross-app automation or copy a user’s token into an example/import file.
