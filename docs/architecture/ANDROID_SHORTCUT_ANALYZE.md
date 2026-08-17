# ANDROID_SHORTCUT_ANALYZE.md — Offer Analyzer on Android (no Vecto app required)

> **Who this is for:** drivers on Android who want the same spoken ACCEPT/REJECT the
> iPhone shortcuts give, and whoever maintains these instructions. Android has no
> Shortcuts app, so a free automation app does the job. The server is identical
> (`POST /api/hooks/analyze-offer`, same token, same response) — only the phone side differs.
>
> **Status (2026-08-17):** interim path (todo #43). Recommended tool = **HTTP Shortcuts**
> (free, open source). **Nothing here has been device-tested yet** — Melody's Android test
> is gate G3 in `OFFER_ANALYZER_ROADMAP.md`. Endgame = the native shell (todo #37), which
> can capture and send the screenshot in one tap with no third-party app.
>
> **Provenance:** tool capabilities verified 2026-08-17 against each app's own
> documentation/source (HTTP Shortcuts docs + `strings.xml`/manifest on GitHub, Tasker user
> guide, MacroDroid wiki, Google/Samsung support pages); server contract from
> `server/api/hooks/analyze-offer.js` at commit `97cd2d3b` (see `OFFER_ANALYZER.md` §4).
> Steps marked *(verify on device)* are inferred from docs, not yet clicked through.
> iPhone: `SIRI_SHORTCUT_ANALYZE.md`. Pipeline: `OFFER_ANALYZER.md`.

---

## Part 0 · Which tool?

| Tool | Cost | Sends the screenshot as a real file (vision lane) | Can take the screenshot itself | Speaks the verdict | Best trigger | Verdict |
|---|---|---|---|---|---|---|
| **HTTP Shortcuts** (Waboodoo, v4.6, Play + F-Droid) | Free, no ads | **Yes** — form-data with a File parameter; accepts an image shared from the screenshot preview | No (uses the share sheet or file picker) | Yes — `speak()` in its JavaScript | Screenshot → **Share → "Send to…"**; or Quick Settings tile (opens a picker) | **Recommended** — 2 taps after the screenshot, free |
| **Tasker** (v6.6) | $4.49 one-time | **Yes** — `image:<path>` in *File To Send* + body fields = multipart | **Yes** (Take Screenshot; needs a one-time ADB/"Tasker Permissions" grant for prompt-free capture) | Yes — *Say* | Quick Settings tile (fully hands-free) or *Received Share* | Best if you want **one tap, no share sheet** and don't mind paying/ADB |
| **MacroDroid** (v5.65) | Free (5 macros, ads) / Pro IAP | **No** — its HTTP action can't do a named multipart file part | Yes (+ built-in ML Kit OCR) | Yes — *Speak Text* | Quick Settings tile | **Text lane only** (screenshot → OCR → JSON) |
| Google Assistant/Gemini Routines, Samsung Modes & Routines / Bixby | — | No HTTP/file actions at all | — | — | — | Can only *launch* one of the apps above |

All three tools appear in the screenshot preview's **Share** sheet (Android 10+; Direct-Share chips on 11+).

---

## Part 1 · Before you build (2 minutes)

1. **Get your token.** In Vecto Pilot: ☰ → **Offer Analyzer** → *Setup* card → **Your shortcut
   token** → Copy (`vp_` + 40 characters). This is what makes the analyzer use **your** rules
   and record offers to **your** account; without it you get default rules and nothing is
   saved for you. Regenerating the token invalidates the old one. **The token belongs to
   one deployment** — copied from the dev workspace it only resolves against dev; against
   `https://vectopilot.com` it is unknown → default rules and no stored row, silently. Use
   the URL of the deployment you copied it from, and verify on run one that a rule you
   enabled shows (e.g. **Show $/hr in results** → `| $NN/hr` in the notification).
2. **Set your rules** on the same page. Changes reach the analyzer within ~15 s.
3. Know how to screenshot: **Power + Volume Down** (Pixel/most phones; Samsung: Side +
   Volume Down, or palm swipe). A small preview appears bottom-left (Pixel) or a toolbar
   (Samsung) with **Share** — that button is the trigger for the recommended flow.
4. Both lanes exist on Android too:
   - **Vision lane** (`source: android_vision`) — send the screenshot file. This is the
     Android default (no OCR dependency).
   - **Text lane** (`source: android_text`) — on-device OCR text as JSON; fastest verdicts
     (milliseconds when your rules alone say REJECT; accepts take a ~0.6–0.9 s model
     round-trip) but needs a tool with OCR (MacroDroid, or Tasker with an OCR plugin).

---

## Part 2 · HTTP Shortcuts — vision lane (recommended)

Install **"HTTP Request Shortcuts"** (Waboodoo) from Google Play or F-Droid.

| # | Where | Set it up like this |
|---|---|---|
| 1 | App → **+** → **Regular HTTP Shortcut** | Name: `Vecto Offer` |
| 2 | Basic settings | **Method: POST** · **URL:** `https://vectopilot.com/api/hooks/analyze-offer` |
| 3 | **Request Headers** → **+** ("Add Header") | Header `X-Shortcut-Token` · Value: *paste your token* |
| 4 | **Request Body / Parameters** | **Request Body Type: Parameters (form-data)** |
| 5 | → **+** → Parameter Type **File** ("Add File Parameter") | Parameter Name `image` · File Data Source **Open File Picker** · leave *File Name* empty · leave cropping unticked |
| 6 | → **+** → Parameter Type **Text** | `source` = `android_vision` |
| 7 | → **+** → Parameter Type **Text** *(optional)* | `device_id` = any label (e.g. `Melody Pixel`) |
| 8 | **Response Handling** | Display Type **Notification** (or Toast) · On Success **Show nothing (run silently)** — the script below does the talking |
| 9 | **Scripting** → *Run on Success* | paste script A (below) |
| 10 | **Scripting** → *Run on Failure* | paste script B (below) |
| 11 | Advanced / **Trigger & Execution Settings** | tick **Allow receiving files from share dialog** (usually on already) · tick **Allow triggering via Quick Settings Tile** · optionally **Show as app shortcut on launcher** (adds a Direct-Share chip and lets Assistant/Bixby launch it) |
| 12 | Advanced → **Timeout** | set **30 s** (default is 10 s; the server caps its model call at 20 s) |
| 13 | Save (✓) | |

Script A — *Run on Success*:

```js
const r = JSON.parse(response.body);
speak(r.voice);
showNotification('Vecto Pilot', r.notification);
```

Script B — *Run on Failure*:

```js
speak('Offer check failed. Decide manually.');
showToast('Vecto Pilot: request failed');
```

**Use it:** on the offer screen → **Power + Volume Down** → tap the preview's **Share** →
choose **"Send to…" (HTTP Shortcuts)** or the Direct-Share chip → it sends the screenshot,
speaks the verdict, and shows the notification. About two taps after the screenshot.

**Quick Settings tile variant:** pull down the shade → edit tiles → add **"Trigger
shortcut"** → tapping it opens the system file picker (choose the newest screenshot) →
sends. Two extra taps versus the share route; useful if the share sheet is cluttered.

**Notes (verified against the app's docs):** `speak()` reads up to 400 characters via the
phone's TTS engine (some devices lack one); `showNotification` asks for notification
permission once; the file picker means the shortcut can't run fully headless; if nothing
happens from the tile, open the app menu → **Troubleshooting** → enable *Allow drawing over
other apps* and exclude the app from Battery/Data Saver.

**One-tap distribution (for us, later):** export the finished shortcut (long-press →
Export), host the `.zip`, and give drivers `https://http-shortcuts.rmy.ch/import?url=<zip-url>`;
keep the token as a global *Static Variable* (mark it *secret*) so each driver only pastes
their own token. *(verify on device)*

**Text lane in HTTP Shortcuts:** not native — no OCR. (Text can be shared *into* a variable
and posted as JSON `{"text": …}`, but that needs a separate OCR step; use MacroDroid or
Tasker for a text lane.)

---

## Part 3 · Tasker — vision lane, fully hands-free (one tap, no share sheet)

Buy/install **Tasker** ($4.49, 7-day trial). If you want prompt-free screenshots, run the
**Tasker Permissions** helper (or `adb shell appops set net.dinglisch.android.taskerm
PROJECT_MEDIA allow`) once; otherwise Android asks for screen-capture consent each run.

**Task "Vecto Offer":**

| # | Action | Fields |
|---|---|---|
| 1 | **Take Screenshot** | File `vp_offer` · Insert In Gallery off *(verify output path on device — commonly `Tasker/screenshots/`)* |
| 2 | **HTTP Request** | Method **POST** · URL `https://vectopilot.com/api/hooks/analyze-offer` · Headers `X-Shortcut-Token:vp_…` (one per line, no spaces) · **Body** `source=android_vision&device_id=MyPixel` · **File To Send** `image:<path-to-vp_offer>` (the `image:` prefix names the multipart part) · Timeout **30** · *Structure Output (JSON)* on · do **not** add a Content-Type header |
| 3 | **Say** | Text `%http_data.voice` |
| 4 | **Notify** | Title `Vecto Pilot` · Text `%http_data.notification` |
| 5 | *(optional)* **Flash** | `%http_response_code %http_data.reason` when the code isn't 200 |

Tasker's guide is explicit that *File To Send* with a `name:` prefix plus a query-string
style Body is sent as `multipart/form-data` — exactly what the server's `image` part needs.

**Triggers:** Preferences → Action → **Quick Settings Tasks** → tile 1 = *Vecto Offer*, then
add the tile in the shade editor (Android 13+: the *Request Add Tile* action). The shade may
be in the screenshot — add a short *Wait* or *Hide Notification Shade* before step 1
*(verify on device)*. Alternative: Profile → Event → System → **Received Share** (Tasker 6.5+)
with `File To Send image:%rs_files(1)` and no Take Screenshot step → then use the
screenshot preview's Share → Tasker.

**Text lane in Tasker:** no built-in OCR. *Get Screen Info (Assistant)* → `%ai_texts`, or
the AutoTools OCR plugin, → JavaScriptlet to build `{ text, source:"android_text", device_id }`
→ HTTP Request with `Content-Type:application/json`. Also possible: **Read Binary** (file →
base64) → JSON `{ "image": "%b64", "image_type": "image/png", "source": "android_vision" }`
— the server strips whitespace/newlines from base64, so Tasker's line-wrapped output is fine.

---

## Part 4 · MacroDroid — text lane (free tier is enough)

MacroDroid's HTTP action cannot send a named multipart file, so use its on-device OCR
(Android 11+) and the JSON text mode.

| # | Step | Fields |
|---|---|---|
| 1 | Add Macro `Vecto Offer` · Trigger **Quick Settings Tile** (Tile 1, button press) | Settings → Quick Settings Tiles → label it; add the tile in the shade |
| 2 | Action **Read Screenshot Contents** | → local array `ocr` · Latin · capture text only (enable the MacroDroid accessibility service when prompted) |
| 3 | Action **JavaScript Code** (or an Iterate loop) | join the array into one string `ocr_text` with newlines |
| 4 | Action **Set Variable** (local dictionary `req`) | `text` = `{lv=ocr_text}` · `source` = `android_text` · `device_id` = your label |
| 5 | Action **JSON Output** | `req` → `body_json` |
| 6 | Action **HTTP Request** | POST `https://vectopilot.com/api/hooks/analyze-offer` · Header Params `X-Shortcut-Token` = `vp_…` · Content Body type `application/json` = `{lv=body_json}` · Block until complete · save code → `http_code` · save response → `resp` |
| 7 | Action **JSON Parse** | `resp` → dictionary `r` |
| 8 | If `http_code` = 200: **Speak Text** `{lv=r[voice]}` + **Display Notification** `Vecto Pilot` / `{lv=r[notification]}` · else **Speak Text** "Offer check failed" | |

Gotchas from the wiki: two accessibility services (*MacroDroid* and *MacroDroid UI
Interaction*); battery optimisation kills macros; apps that set `FLAG_SECURE` defeat
screenshots/OCR (whether the Uber/Lyft driver apps do is **unverified**).

---

## Part 5 · Test, then troubleshoot

**Field-test protocol (G3):** in HTTP Shortcuts' *Run on Success* script add
`showToast('server ' + r.response_time_ms + ' ms')` for the first runs and note it next to
the felt tap-to-speech time — the difference is phone overhead (share sheet, radio wake,
TTS), which the server bench can't see.

Same expectations as iPhone (see `SIRI_SHORTCUT_ANALYZE.md` Part 4): "Accept. dollar forty
per mile, 6 miles." + `ACCEPT: $1.40 6.1mi`; rejects end with the reason ("too far",
"below floor", "long pickup", "too long", "low rider rating", "rate too low"); `ACCEPT
(FALLBACK)` = Acceptance-Rate-Protection; `| Filter Detected` / `| Verified Rider` notices;
"No data. Decide manually." when nothing was readable.

| Symptom | Fix |
|---|---|
| Notification `Missing text or image payload` (400), or a blank failure with nothing spoken | The file parameter **must be named exactly `image`** (a File parameter with another name is a server error, not a 400 — the aliases `screenshot`/`photo` only apply to base64 *string* fields) or the body type isn't form-data; files over 5 MB fail the same way. For the text lane the JSON key must be `text` (`ocr_text`/`ocr` accepted) |
| Rules don't apply / offers missing from the web page | Token missing or misspelled — must be the header `X-Shortcut-Token` (a body field `shortcut_token`/`token` also works). Also open Vecto Pilot once per shift so your session has a location (rows need a real timezone; roadmap L5) |
| Nothing spoken | HTTP Shortcuts: `speak()` needs a TTS engine (Settings → System → Languages → Text-to-speech); Tasker: check *Say* engine; MacroDroid: *Speak Text* audio stream |
| Times out | Raise the tool's timeout to 30 s; the server answers deterministic rejects in ms and model verdicts in ~0.6–0.9 s, but caps the model call at 20 s |
| Nothing spoken/shown after several rapid runs | Probably the rate limit (429) — 20 analyses/min per phone; the 429 body has no `voice`/`notification` keys, so the *Run on Failure* script speaks the failure line; wait a moment |
| Shortcut won't run from tile/home screen (HTTP Shortcuts) | App menu → Troubleshooting → *Allow drawing over other apps*; exclude from Battery/Data Saver |

---

## Part 6 · Server contract recap (for maintainers)

Identical to iPhone — `OFFER_ANALYZER.md` §4:

| Item | Contract |
|---|---|
| Endpoint | `POST https://vectopilot.com/api/hooks/analyze-offer` (also accepts `application/x-www-form-urlencoded` and JSON) |
| Identity | Header `X-Shortcut-Token: vp_…` (preferred) or body field `shortcut_token` |
| Vision | multipart part named `image` (raw file), or JSON `image` (base64; data-URL prefix and whitespace tolerated), `image_type` optional; screenshots >250 KB are downscaled server-side |
| Text | JSON/urlencoded field `text` |
| `source` | `android_vision` / `android_text` (stored verbatim; iPhone uses `siri_vision` / `siri_text`) |
| Response | `{ success, voice, notification, decision, reason, notices, response_time_ms }` — speak `voice`, show `notification` |
| Aliases (case-insensitive, string fields only; the multipart file part must be exactly `image`; companion endpoints don't normalize) | `screenshot`/`photo`→`image` (base64 string); `ocr_text`/`ocr`→`text`; `token`/`shortcuttoken`→`shortcut_token`; `deviceid`/`device`→`device_id`; `lat`/`lattitude`→`latitude`; `lng`/`lon`/`long`→`longitude` |

Not needed and not sent: GPS coordinates (the server geocodes the offer's own addresses in
Phase 2). Ideas surfaced by the tool research, filed on the roadmap: a raw `image/jpeg` body
mode would let MacroDroid do vision; HTTP Shortcuts' `getDeviceId()` is a stable
`device_id` source; a hosted import zip makes setup one tap.
