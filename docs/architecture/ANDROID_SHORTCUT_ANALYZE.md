# Offer Analyzer on Android

Feature names follow the [canonical lexicon](../../LEXICON.md): **Offer Analyzer**
analyzes and tracks **offers**.

> Updated 2026-10-05. The browser capture flow and optional HTTP Shortcuts launcher
> remain available. Part 4 documents the MacroDroid text workflow inspected and
> repaired on one Samsung Android phone, with separate device-test evidence and
> user-reported success. A fresh installation, other phones and other driver apps
> still need their own checks; no universal macro import is provided.

## Part 1 · Current browser setup

**No macro app is required for browser capture.** Sign-in supplies the account;
drivers do not need to copy a shortcut token for this option.

1. Sign in to your deployment, open **Offer Analyzer → Rules & Setup → Phone Setup**, and review
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

### Reducing setup further

The current browser flow is the available option without a macro app. A future
**Share → Offer Analyzer** entry could remove the separate file-picker step:
Chrome's [Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
supports incoming image files for installed web apps. This repository does not yet
implement its manifest/share handler; it still needs development and Android testing.

For the existing MacroDroid flow, a scrubbed, import-tested macro with the endpoint
preconfigured would save manual editing. Each driver would still supply their own
token and approve phone permissions. No certified downloadable macro is included.
Independent cross-app capture would require a native phone component; Android's
[MediaProjection](https://developer.android.com/media/grow/media-projection)
requires capture consent and has a lifecycle that can end on lock or process loss.
The illustrated guide is an interim manual-screenshot setup, not an always-running
automatic capture guarantee.

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
Keep personal macro backups private: they can contain the token and captured text.
A distributable must be scrubbed and newly configured by its owner. **Every person
must use their own shortcut token from their own signed-in account.**

The historical direct-upload recipes omit GPS; later enrichment resolves trusted card
locations/timezone where possible. That is distinct from current browser GPS validation.
Text and vision both enter Phase 1. A screenshot input is not a synonym for Phase 2.
Older HTTP Shortcuts/Tasker menu recipes and prices are retained only in the historical
version referenced by the removal ledger, not asserted as current product instructions.

## Part 4 · MacroDroid screenshot setup

This workflow keeps the phone's usual screenshot gesture. A saved screenshot triggers
MacroDroid, which reads the **current screen**, sends its OCR text to Offer Analyzer,
and uses the returned notification and spoken result. Keep Uber Driver visible until
capture completes. The saved screenshot remains on the phone; this recipe sends text,
not that image file. MacroDroid's [Read Screenshot Contents documentation](https://macrodroidforum.com/wiki/index.php?title=Action%3A_Read_Screenshot_Contents)
describes the fresh capture and array output.

The verified foreground selection is **Uber Driver only**. It prevents ordinary
screenshots from other apps entering this macro. It can still analyze an Uber map,
earnings or other non-offer screen; foreground filtering does not recognize offers.
Set up and test while parked. MacroDroid menu wording can vary by version.

### Step 1 · Back up and get your own connection details

1. If you already have an analysis macro, use MacroDroid's **Export/Import** facility
   to save a private backup before editing. Keep the original screenshots too.
   Disable the macro during configuration so an unfinished request cannot run.
2. Sign in to **your own account** on the VectoPilot deployment you use. Open
   **Offer Analyzer → Rules & Setup → Phone Setup**, review your services and rules, and copy the
   hook URL for that deployment.
3. In **Your shortcut token**, copy **your token**. Each person must paste their own
   value into the HTTP header in Step 5. Do not copy the token from another person's
   screenshot, macro or account. The example `YOUR_SHORTCUT_TOKEN` is a placeholder.
4. If you regenerate your token later, replace it in your macro too. The previous
   token stops working. A token from one deployment must not be paired with another
   deployment's hook URL.

The browser launcher in Part 2 does not configure MacroDroid. The existing iPhone
shortcut uses a separate setup described in [the iPhone guide](SIRI_SHORTCUT_ANALYZE.md).

### Step 2 · Allow the required phone access

1. Configure **Application Running → Running in foreground → Uber Driver** using
   the **App History** detection option. Allow MacroDroid **Usage Access** when
   requested. On the tested Samsung this was Android **Settings → Special access →
   Usage data access → MacroDroid**. The permission was initially off; enabling it
   was necessary for the tested foreground checks.
2. Follow the **Read Screenshot Contents** action's permission prompts, including
   MacroDroid's screen-reading/accessibility service where requested. For a screen
   capture prompt, select **Entire screen**. The earlier Samsung test produced blank
   OCR with a single-app grant; repeat the capture check on your phone.
3. Give the **File Changed** trigger the storage access it requests, and select the
   actual folder where your phone saves screenshots. Do not assume every phone uses
   the same path.
4. Allow MacroDroid notifications if you want the visible result. Check Android
   text-to-speech/audio settings for **Speak Text**. If Android restricts background
   operation, review MacroDroid's battery settings. These settings do not guarantee
   uninterrupted capture; verify the workflow after configuring them.

### Step 3 · Create the local variables

In the macro editor, use **Local Variables** to create these names and types. Keep
them local to this macro. Use the magic-text picker beside an action field to insert
references; [MacroDroid's variable guide](https://macrodroidforum.com/wiki/index.php?title=Variables)
explains local references and the available types.

| Name | Type | Purpose |
|---|---|---|
| `ocr_arr` | Array | Text recognized from the current screen. |
| `req` | Dictionary | Request fields; create a String entry named `text`. |
| `body_json` | String | JSON Output from `req`. |
| `resp` | String | Current HTTP response body. |
| `code` | Integer | Current HTTP status code. |
| `r` | Dictionary | Parsed response fields, including `notification` and `voice`. |

For this text recipe, a String entry `req[source]` may be set to `android_text`.
The account token belongs in the HTTP header, not the OCR text or a device label.

### Step 4 · Configure the trigger and all three foreground checks

1. Add or inspect **File Changed**, choose **Created**, and select your screenshots
   directory. The verified Samsung path was
   `/storage/emulated/0/Pictures/Screenshots/`, with file filter `*`. Modified/deleted
   events are not part of this recipe.
2. In the macro's **Constraints**, add **Application Running**, select **Uber Driver**
   in the foreground, and use **App History** as in Step 2. This checks the app when
   the screenshot event tries to start the macro. Do not select every application.
3. Add an **If** using that same foreground condition immediately before **Read
   Screenshot Contents**, after any existing wait. Place all capture, request and
   result actions inside this block.
4. Add a second **If** with the same condition immediately before **HTTP Request**.
   Place the HTTP action and **all** response parsing, notification and speech actions
   inside this second block. The first execution check catches a switch during the
   wait; the second catches a switch during OCR.

The inspected existing macro retains **Wait Until Trigger → File Changed**, with
the same Created event, a **1-second timeout** and **Continue on timeout**. Preserve
those settings when repairing that workflow; the first execution guard goes after
this wait. Its row labeled `.03 seconds wait` is only a **Separator**, not a timed
action. Do not create an extra delay by copying that label.

An existing **Accessibility Service Enabled** trigger was also preserved in that
repair. It detects a service-state event, not a screenshot; it is not a required
new screenshot trigger. Rebuilding this recipe on a fresh installation still
requires the tests below. [Wait Until Trigger](https://macrodroidforum.com/wiki/index.php?title=Action%3A_Wait_Until_Trigger)
can resume on a later matching event or its configured timeout.

The guards must enclose the actions, as supported by MacroDroid's
[If condition](https://macrodroidforum.com/wiki/index.php/Action%3A_If_clause).
Constraining only HTTP can leave later actions free to parse or speak an old response.
Do not rely on the macro-wide constraint alone after a wait.

### Step 5 · Assemble the current text, request and response

Inside the first foreground block, add the actions in this order:

1. **Read Screenshot Contents** → local Array `ocr_arr`.
2. **Set Variable** → Dictionary `req`, entry `text`, String value. Insert local
   `ocr_arr` using the magic-text picker and choose **Standard Format**. The tested
   reference is `{lv=ocr_arr}`. Assign it when the macro runs; a dictionary template
   containing literal magic text did not reliably substitute the current capture.
   The server accepts the resulting `[0]: … [1]: …` representation.
3. **JSON Output** → input Dictionary `req`, output String `body_json`. This handles
   quotes and line breaks; do not hand-build JSON around OCR text.
4. Open the second foreground **If**, then configure **HTTP Request**:

| HTTP setting | Value |
|---|---|
| Method | `POST` |
| URL | Your deployment's hook URL, ending in `/api/hooks/analyze-offer`. |
| Content type | `application/json` |
| Content body | Text using local variable `{lv=body_json}`; not a saved image file. |
| Header name | `X-Shortcut-Token` |
| Header value | Paste **your own** token copied from Phone Setup. Replace `YOUR_SHORTCUT_TOKEN`. |
| Save response | Local String `resp`. |
| Save return code | Local Integer `code`. |
| Block next action until complete | Enabled. |

5. After HTTP, **JSON Parse** → input String `resp`, output Dictionary `r`.
6. Add **If `code = 200`**, then **Display Notification** with text
   `{lv=r[notification]}` and **Speak Text** with `{lv=r[voice]}`. Use the picker to
   select those dictionary entries. Keep **Voice Search** disabled or absent: it
   opens the assistant feature and is not needed to speak the result.
7. Close the status **If**, the pre-request foreground **If**, and the outer
   foreground **If**. Save and reopen the macro to verify nesting and enabled states.

The resulting action order is:

```text
Existing wait, if present (verified configuration: 1 second, continue on timeout)
If Uber Driver is in the foreground
    Read Screenshot Contents → ocr_arr
    Set req[text] from ocr_arr, Standard Format
    JSON Output req → body_json
    If Uber Driver is in the foreground
        HTTP POST body_json → resp and code; wait for completion
        JSON Parse resp → r
        If code = 200
            Display Notification: r[notification]
            Speak Text: r[voice]
        End If
    End If
End If
```

The [HTTP Request documentation](https://macrodroidforum.com/wiki/index.php/Action%3A_HTTP_Request)
describes body/header fields and saved response variables; [JSON Parse](https://macrodroidforum.com/wiki/index.php?title=Action%3A_JSON_Parse)
converts the response String into a Dictionary. Preserve the sequence: capture →
assign `req[text]` → JSON Output → HTTP → parse → output. Reordering it previously
caused the preceding offer to be sent.

### Step 6 · Test the filter before enabling transmission

Temporarily disable **HTTP Request, JSON Parse, Display Notification and Speak Text**
together. Keep Voice Search disabled. Enable the macro and inspect its **System Log**
after each test; do not publish logs containing OCR or credentials.

| Test while parked | Expected result |
|---|---|
| Take a normal screenshot in Settings. | Foreground constraint blocks the macro; no OCR/request path. |
| Take one screenshot with Uber Driver visible and leave it visible. | One invocation reaches OCR, request assembly and the second guard; disabled HTTP sends nothing. |
| Take a screenshot in Uber, then switch to Settings during the existing wait. | The first execution guard fails; OCR and the whole remaining block are skipped. |
| Switch out of Uber after OCR starts. | The second execution guard fails; HTTP and its entire output block are skipped. |

If a check fails, leave transmission disabled and correct the permissions, selected
app, folder or block nesting. After these checks pass, restore the four actions,
save, and confirm that a Settings screenshot is still blocked. Then use one genuine
offer while parked, keep Uber visible, and verify the current analysis, spoken
result and corresponding offer in your account. Check these separately: HTTP success
or speech alone does not establish that the offer was saved.

### What was verified and what remains limited

During the October 4 Chicago evening repair (October 5 UTC), independent log checks
passed all four filter tests above on a Samsung SM-S948U running Android 17. The
allowed-app and switch-away tests used disabled HTTP/output actions. A subsequent
Settings test also passed with normal HTTP/output actions enabled. A saved export
comparison verified the two added guards, original action order, unchanged request
configuration and disabled Voice Search.

Melody subsequently reported that the macro worked perfectly. That is user-reported
functional success; the repair tests did not independently measure a new genuine
offer's server-storage/speech roundtrip or capture-to-speech latency. The older
September field tests remain historical evidence, not a fresh-install certification.

Foreground checks reduce the observed switching races but are not an atomic
capture-provenance guarantee. The repair preserves the existing network-error,
response-state and overlapping-invocation behavior; it does not establish that stale
response speech, malformed responses or rapid repeated captures are handled. Do not
reuse an earlier recommendation after a failed or incomplete check. Other platforms
need their own app selection and tests at **all three** foreground checks. The recipe
adds no background offer discovery, GPS capture, automatic acceptance or durable
offline upload queue. Keep private exports out of shared setup pictures and templates.

## Part 5 · Historical MacroDroid field-tested lessons (August 2026)

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

## Part 6 · Test and troubleshoot

While stopped, verify current offer capture, selected service, pickup/trip distinction,
chosen rate basis, personal rules, speech, errors and history. Measure the entire
capture-to-speech interval. Check a non-offer image and a delayed response too.

| Symptom | Check |
|---|---|
| Screenshots from other apps start analysis | All three foreground checks, Usage Access, and the nested request/output blocks in Part 4. |
| Uber screenshots never reach OCR | Actual screenshots folder, Created event, App History/Usage Access, screen permission and System Log. |
| Previous offer analyzed | Variable assignment → JSON output → HTTP order; current file rather than an old saved screenshot. |
| Empty OCR | Capture permission and actual current screen; app/phone restrictions need device diagnosis. |
| Token/rules failure | Token from the same deployment; unknown supplied tokens fail closed. |
| 413 response | Body/file exceeds 5 MiB; handle the returned manual-decision response. |
| Speech absent | Actual parsed `voice`, phone/browser audio and visible error path. |
| Result appears but no history row | Phase 2/storage may fail after speech, and unresolved trusted timezone prevents storage. |

## Part 7 · Maintainer reference

[Canonical Analyzer contract](OFFER_ANALYZER.md) covers transport, rules, decision
provenance, storage and outcomes. [Roadmap](OFFER_ANALYZER_ROADMAP.md) separates current
code from device gates and future native integration. Do not mark the browser launcher
as certified cross-app automation or copy a user’s token into an example/import file.

The in-app illustrated guide is `AndroidMacroDroidGuide.tsx`, mounted in
`SetupCard.tsx`. Its seven self-contained SVG diagrams live in
`client/public/guides/macrodroid/`; they are schematic illustrations, not phone
screenshots. Keep these instructions and the pictures aligned. The guide uses
the current site origin and the existing signed-in account token copy action;
no personal token, request export or device capture is part of its static assets.
