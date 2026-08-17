# SIRI_SHORTCUT_ANALYZE.md — Build the Offer Analyzer shortcuts on iPhone

> **Who this is for:** drivers setting up hands-free offer analysis on an iPhone, and
> whoever maintains the shortcuts. Part 1–4 are end-user steps; Part 5 is the exact
> server contract the shortcuts must satisfy; Part 6 is history (what the older
> "Analyze 2" shortcut got wrong and why the spec looks the way it does).
>
> **Status (2026-08-17):** the two canonical shortcuts below are the joint spec of
> 2026-08-14 (Melody + Claude). Install links are added here by Melody once she has built
> and shared them from her iPhone; until then, build them by hand from Part 2–3 (about
> five minutes each). The Offer Analyzer page's Setup card still shows the July "Analyze 2"
> link and instructions — those are superseded by this doc (roadmap L3).
>
> **Provenance:** server contract verified against `server/api/hooks/analyze-offer.js` at
> commit `97cd2d3b` (see `OFFER_ANALYZER.md` §4); shortcut anatomy from plist decodes of
> Melody's shared shortcuts (2026-07-03, 2026-08-14); Apple Shortcuts action names checked
> against Apple's Shortcuts User Guide (iOS 18 / iOS 26, August 2026).
> Android: `ANDROID_SHORTCUT_ANALYZE.md`. Pipeline: `OFFER_ANALYZER.md`.

---

## Part 1 · Before you build (2 minutes)

1. **Get your token.** In Vecto Pilot: ☰ menu → **Offer Analyzer** → *Siri Shortcut
   Setup* card → **Your shortcut token** → tap **Copy**. It looks like `vp_` followed by 40
   letters/digits. This token is what makes the analyzer use **your** rules and record
   offers to **your** account. Without it you still get an answer, but under default rules
   and nothing is saved for you. Regenerating the token invalidates the old one — update
   both shortcuts if you do.
   **Your token belongs to one deployment.** A token copied from the dev workspace page
   only resolves against the dev database; pointed at `https://vectopilot.com` (prod) it is
   an unknown token → default rules and no stored row (`ruleset_hash NULL`) — silently.
   Point the shortcut's URL at the same deployment you copied the token from, and on your
   first run check that a rule you personally enabled shows up (e.g. turn on **Show $/hr in
   results** — if the notification has no `| $NN/hr`, your token did not resolve there).
2. **Set your rules** on the same page (rate floors, rating floor, pickup limits, avoid
   places, notices such as "Filter Detected"). Save. The shortcuts pick up rule changes
   within about 15 seconds.
3. Make sure the **Shortcuts** app is installed (it ships with iOS; re-download from the
   App Store if removed). Requirements: iOS 14.5+ for **Take Screenshot**, iPhone XS/XR or
   newer for on-device text recognition (**Extract Text from Image**); iOS 26 is current and
   changed none of these actions.
4. You will build **two** shortcuts:
   - **Analyze Offer Text** — the daily driver. On-device text recognition, tiny upload,
     fastest verdict (a few milliseconds when your rules alone say REJECT; accepts take a
     ~0.6–0.9 s model round-trip).
   - **Analyze Offer Vision** — sends the screenshot itself so the model can see the map,
     badges, and route shape. A little slower; best when the text version says
     "No data" or for the odd card layout.

Both speak the verdict and show a notification. Nothing needs Location permission.

---

## Part 2 · Shortcut 1 — "Analyze Offer Text" (fast lane)

Open **Shortcuts** → **+** (new shortcut) → rename it **Analyze Offer Text** (tap the
title → Rename). Add the actions below in order (tap **Add Action** / the search bar and
type the action name):

| # | Action (search this name) | Set it up like this |
|---|---|---|
| 1 | **Take Screenshot** | no options |
| 2 | **Extract Text from Image** | Input: **Screenshot** (it fills in automatically) |
| 3 | **Combine Text** | Combine **Text** (from step 2) with **New Lines** |
| 4 | **Get Contents of URL** | See the box below — this is the only fiddly step |
| 5 | **Get Dictionary Value** | Get **Value** for **`notification`** in **Contents of URL** |
| 6 | **Show Notification** | Body: **Dictionary Value** (from step 5) |
| 7 | **Get Dictionary Value** | Get **Value** for **`voice`** in **Contents of URL** ← pick the *Contents of URL* variable from step 4, not the previous Dictionary Value |
| 8 | **Speak Text** | Text: **Dictionary Value** (from step 7). Leave **Wait Until Finished** on |

**Step 4 — Get Contents of URL, exactly:**

- URL: `https://vectopilot.com/api/hooks/analyze-offer`
- Tap the small arrow to expand → **Method: POST**
- **Headers** → *Add new header*:
  - Key `X-Shortcut-Token` · Value: *paste your token*
- **Request Body: JSON** → *Add new field* (type **Text**) three times *(field-type labels: verify on device — Apple documents JSON/Form/File body types and "add files as field values" for Form)*:

  | Key | Type | Value |
  |---|---|---|
  | `text` | Text | **Combined Text** (magic variable from step 3) |
  | `source` | Text | `siri_text` (type it literally) |
  | `device_id` | Text | any label you like, e.g. `Melody iPhone` (optional; display only) |

That's the whole shortcut. Tap **Done**.

> Why JSON and not Form here: a Form body that contains only text fields is sent as
> `x-www-form-urlencoded`. The server accepts that too (since 2026-08-14), but JSON is
> the canonical choice for the text lane. The Vision shortcut uses Form because it
> carries a file.

---

## Part 3 · Shortcut 2 — "Analyze Offer Vision" (deep lane)

New shortcut → rename **Analyze Offer Vision** → actions:

| # | Action | Set it up like this |
|---|---|---|
| 1 | **Take Screenshot** | no options |
| 2 | **Get Contents of URL** | See the box below |
| 3 | **Get Dictionary Value** | Get **Value** for **`notification`** in **Contents of URL** |
| 4 | **Show Notification** | Body: **Dictionary Value** (step 3) |
| 5 | **Get Dictionary Value** | Get **Value** for **`voice`** in **Contents of URL** (variable from step 2) |
| 6 | **Speak Text** | Text: **Dictionary Value** (step 5) |

**Step 2 — Get Contents of URL, exactly:**

- URL: `https://vectopilot.com/api/hooks/analyze-offer`
- **Method: POST**
- **Headers**: `X-Shortcut-Token` = *your token*
- **Request Body: Form** → *Add new field*:

  | Key | Type | Value |
  |---|---|---|
  | `image` | **File** ← choose *File*, not Text | **Screenshot** (magic variable from step 1) |
  | `source` | Text | `siri_vision` |
  | `device_id` | Text | optional label |

No text-recognition action, no `text` field — pure vision. (You may add both a `text`
field from Extract Text and the `image` File field to one shortcut; the server uses both.
It costs a little time, so the canonical setup keeps them separate.)

**Optional in either shortcut** (after Take Screenshot): **Save to Photo Album** → album
of your choice, if you want an archive of offer cards. Skipping it avoids the Photos
permission prompt.

---

## Part 4 · Run it hands-free, then test

**First run:** the shortcut will ask for permission to take screenshots and to contact
`vectopilot.com` — allow both ("Always Allow" for the URL keeps it silent). If you added the
Save to Photo Album step it will ask for Photos access.

**Triggers that work while the Uber/Lyft app is on screen** (pick one or more; each can
be assigned to either shortcut):

| Trigger | Where to set it |
|---|---|
| **Back Tap** (double/triple tap the back of the phone) | Settings → Accessibility → Touch → Back Tap → Double Tap / Triple Tap → pick the shortcut |
| **Action Button** (iPhone 15 Pro and later) | Settings → Action Button → Shortcut → pick the shortcut |
| **Voice** | Say "Hey Siri, Analyze Offer Text" — works by the shortcut's name, no setup. Prefer Back Tap / Action Button for the **Vision** shortcut: launching via Siri puts the Siri overlay into the screenshot |
| **AssistiveTouch** floating button | Settings → Accessibility → Touch → AssistiveTouch → Single-Tap → pick the shortcut |
| **Control Center / Lock Screen control** (iOS 18+) | Customize Control Center → Add a Control → search "Shortcut" → choose the shortcut (also assignable to the Lock Screen bottom controls) |
| **Home Screen icon** | In Shortcuts, tap the ⓘ on the shortcut → Add to Home Screen |

**Test before you drive:** open a saved offer screenshot (or a live offer), run the
shortcut. Expected results below. **Field-test protocol (G1/G3):** for the first few
runs add one extra action after Get Contents of URL — *Get Dictionary Value* `response_time_ms`
→ *Show Notification* — and note it next to the felt tap-to-speech time; the difference is
pure phone overhead (OCR, radio wake, TTS spin-up), the one number the server bench can't see.

| You hear / see | Meaning |
|---|---|
| "Accept. dollar forty per mile, 6 miles." + `ACCEPT: $1.40 6.1mi` | Rules (or the model) accepted |
| "Reject. seventy-eight cents per mile, 14 miles, too far." + `REJECT: $0.78 14.0mi too far` | Rejected. Spoken tail: `too far` / `below floor` / `long pickup` / `too long` / `low rider rating` / `rate too low` / `fallback accept`. Notification tail uses the terse literals: `too far`, `floor`, `pickup`, `over time`, `rating`, `low`, `min`, `fallback` (+ ` prem`/` comf`/` xl` for premium tiers) |
| "Accept. … fallback accept." + `ACCEPT (FALLBACK): …` | Accepted only because your Acceptance-Rate-Protection floor cleared |
| Notification ends with `\| Filter Detected` / `\| Verified Rider` | A notice you enabled was seen on the card |
| "Reject. Share tier." | Uber Share / Lyft Shared auto-reject |
| "No data. Decide manually." | Nothing usable could be read from the text/screenshot — try the Vision shortcut or retake |
| "Analysis failed. Decide manually." | Server error; the app is still up, try again |

**Troubleshooting**

| Symptom | Fix |
|---|---|
| Notification says `Missing text or image payload` (HTTP 400) | The body field is misnamed or in the wrong section. `text` (JSON, Text) or `image` (Form, **File**) must be a *body field*, not a header. For the text lane, variants like `ocr_text` / `Text` are accepted automatically; **the File field must be named exactly `image`** — a File field with another name fails as a server error with nothing spoken |
| Blank notification and silence right after running (not the rate limit) | The screenshot file part exceeded 5 MB or was misnamed — the server's generic error has no `voice`. Screenshots are normally ~1 MB; a **Convert Image → JPEG** step before Get Contents of URL shrinks large PNGs |
| Rules you set don't seem to apply | Token missing or pasted into a body field instead of the **Headers** section (a body field named `shortcut_token` also works). Copy it again from the Setup card |
| Nothing is spoken but the notification shows | Speak Text must read the `voice` key (step 7/5), not `notification` — the notification string contains `$` and `/` that Siri reads badly |
| Nothing at all after several rapid runs (blank notification, silence) | Probably the rate limit — 20 analyses per minute per phone. The 429 reply has no `voice`/`notification` keys, so the shortcut shows nothing; wait a moment |
| Very slow (>10 s) | Check the network; Shortcuts gives up on a request after roughly 25–30 s (community-reported, not documented by Apple). The server answers deterministic rejects in milliseconds and model verdicts in roughly 0.6–0.9 s (2026-08-17 measurements on the real endpoint) |
| Offers don't appear on the web page | The token wasn't sent (see above), or the app hasn't resolved your location this shift — open Vecto Pilot once so your session has a current snapshot (rows need a real timezone; see roadmap L5) |

---

## Part 5 · Server contract (for whoever edits the shortcuts)

`POST https://vectopilot.com/api/hooks/analyze-offer` — full detail in `OFFER_ANALYZER.md` §4.

| Item | Contract |
|---|---|
| Identity | Header `X-Shortcut-Token: vp_…` (preferred) or body field `shortcut_token`. No token → default rules and the offer is not attributed to you. Storage needs a real timezone: with no coordinates the server resolves it from the card's **pickup address** (first address on the card), else from your app session — so an offer whose pickup can't be read is stored only if you have an app session (`OFFER_ANALYZER.md` §10.4) |
| Body types | `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data` (file part must be named `image`) |
| Fields | `text` and/or `image` (one required); `source` (`siri_text` / `siri_vision`); `device_id` (optional label); `latitude`/`longitude` optional and **not sent** by the canonical shortcuts |
| Field-name tolerance | Deterministic alias table, case-insensitive, **string fields only** (the multipart File part must be named exactly `image`): `ocr_text`/`ocr`→`text`; `screenshot`/`photo`→`image` (base64 string); `lattitude`/`lat`→`latitude`; `lng`/`lon`/`long`/`longitud`→`longitude`; `token`/`shortcuttoken`→`shortcut_token`; `deviceid`/`device`→`device_id`; `imagetype`/`mime_type`/`mimetype`→`image_type`. Remaps are warn-logged server-side |
| Response (200) | `{ success, voice, notification, decision:'ACCEPT'\|'REJECT'\|'NO DATA', reason, notices:[], response_time_ms }` — speak `voice`, show `notification`, branch on `decision` if you add logic. (The share auto-reject reply omits `notices`.) |
| Errors | 400 `{ error:'Missing text or image payload' }`; 429 rate limit; 500 `{ success:false, voice:'Analysis failed. Decide manually.', … }` |
| Limits | 5 MB body; screenshots >250 KB are downscaled server-side (no need to Convert Image on the phone) |
| Timing | Shortcut network timeout ≈25–30 s (undocumented by Apple); server Phase-1 cap 20 s; typical: deterministic text REJECT ~1–5 ms, model verdicts ~0.6–0.9 s |

Token-**required** companions for advanced shortcuts: `GET /api/hooks/offer-history?limit=20`
(read), `POST /api/hooks/offer-override { id, user_override:'ACCEPT'|'REJECT' }` (writes
`user_override` on your own row), `POST /api/hooks/offer-cleanup { ids:[…≤50] }` (deletes
your own rows).

Re-decode any shared shortcut: `curl -s https://www.icloud.com/shortcuts/api/records/<id>`
→ `fields.shortcut.value.downloadURL` → binary plist → `plistlib`.

---

## Part 6 · History and joint decisions (why the spec looks like this)

Decoded from Melody's live "Analyze 2" (9 actions, iCloud id `6d89f1139413453d9b5e910ffc3fd8b2`, 2026-08-14):

1. **No `image` field existed** — screenshots were taken, saved, OCR'd, and never uploaded;
   every live verdict to that date (including the Siri-vs-ours A/B that validated the
   analyzer) came from the **text** path alone.
2. Junk rows in the Headers section (`text`, `latitude`, `longitude` entered as headers) —
   harmless (ignored) but fragile; removed in the canonical specs.
3. `lattitude` typo in the body — GPS silently dropped for months; now handled forever by
   the alias table, and the canonical shortcuts drop coordinates entirely.
4. The token **was** present and correct in Headers — per-driver rules genuinely applied.
5. Response wiring read only `notification` (spoken and shown); canonical specs speak `voice`.
6. Root cause of the first `analyze-offer-text` 400: a Form body with only text fields is
   `x-www-form-urlencoded`, which the server did not parse until 2026-08-14
   (`express.urlencoded` on `/api/hooks`, shipped in publish `863d6ca3`).

Joint decisions (2026-08-14): two shortcuts, no **Get Current Location** (costs seconds
inside a 3-second Match window; pattern data comes from Phase-2 geocoding of the offer's
own addresses — consistent with Melody's 2026-07-03 vision-first decision: "the screenshot
ONLY — no OCR extraction, no GPS", memory #354); `source` keys
`siri_text` / `siri_vision` stored verbatim; token in the real Headers section.

Older history (2026-07-03 decode of the 11-action "Analyze 2", iCloud id
`cce34c892b394d3fb3e5cebd19f317c5` — the link still on the Setup card): text + `lattitude`
+ location, no image; the fixes it needed are exactly the items above.
