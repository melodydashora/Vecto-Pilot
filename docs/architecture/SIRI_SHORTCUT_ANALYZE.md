# SIRI_SHORTCUT_ANALYZE.md — Offer Analyzer Shortcut ground truth

> **Provenance:** Shortcuts authored by Melody; anatomy decoded by Claude from
> the shared iCloud links by parsing the actual plists — never inferred.
> Decodes: 2026-07-03 (11-action "Analyze 2"), 2026-08-14 (9-action "Analyze 2",
> link `icloud.com/shortcuts/6d89f1139413453d9b5e910ffc3fd8b2`).
> Re-decode any time: `curl -s https://www.icloud.com/shortcuts/api/records/<id>`
> → `fields.shortcut.value.downloadURL` → binary plist → `plistlib`.
>
> **Canonical spec (2026-08-14, joint):** TWO official shortcuts —
> **analyze-offer-text** (fast lane) and **analyze-offer-vision** (deep lane).
> Melody builds them exactly per the specs below; this doc is the build card.

## Server contract (`POST https://vectopilot.com/api/hooks/analyze-offer`)

- Body type **Form**. Three accepted input modes: text-only, image-only,
  text+image (`analyze-offer.js` mode comment).
- **Identity:** header `X-Shortcut-Token: vp_…` (minted on the Offer Analyzer
  page's Setup card). Also accepted as form field `shortcut_token`.
  **No token → DEFAULT_RULESET + anonymous row** — the driver's sliders
  silently don't apply. The token IS the product.
- **Field-name tolerance (2026-08-14):** all body keys pass through the
  deterministic alias table in `server/lib/offers/normalize-offer-body.js`
  (case-insensitive; `lattitude`/`lat`/`lng`/`lon`/`long`/`token`/… → canonical;
  every remap warn-logged). End users are never told to fix their spelling —
  but new shortcuts should still use canonical keys.
- **Response keys:** `notification` (one-line verdict for Show Notification —
  notices like "Filter Detected" already appended), `voice` (speech-optimized
  string for Speak Text), `decision`, plus data fields.

## analyze-offer-text (fast lane — the daily driver)

Goal: verdict inside the offer window; OCR is on-device and near-instant, the
payload is tiny, and the server pre-parses text deterministically in <1ms.

| # | Action | Settings |
|---|--------|----------|
| 1 | Take Screenshot | |
| 2 | *(optional)* Save to Camera Roll | album "Uber rides" (archive habit) |
| 3 | Extract Text from Image | input: Screenshot |
| 4 | Combine Text | separator: New Line, input: Text from step 3 |
| 5 | Get Contents of URL | POST, body **JSON** — fields below (see body-type note) |
| 6 | Get Dictionary Value | key `notification` |
| 7 | Show Notification | body: Dictionary Value (step 6) |
| 8 | Get Dictionary Value | key `voice` (input: step 5's contents) |
| 9 | Speak Text | text: Dictionary Value (step 8) |

> **Body-type note (2026-08-14 root cause):** a Shortcuts "Form" body with only
> text fields ships as `application/x-www-form-urlencoded`, which the deployed
> server never parsed — Melody's first analyze-offer-text build 400ed exactly
> this way ("Missing text or image payload") with a PERFECT field config
> (plist-verified). `express.urlencoded` is now mounted on `/api/hooks`
> (bootstrap/middleware.js), so Form works after the next deploy — but JSON is
> the canonical choice for the text lane regardless. Vision stays Form: its
> File field makes the request multipart, which multer always handled.

**Step 5 form fields:**

| Field | Value |
|-------|-------|
| `text` | Combined Text (step 4) |
| `source` | `siri_text` (literal) |
| `device_id` | friendly label (optional — display only) |

**Step 5 headers:** `X-Shortcut-Token` = the `vp_…` token. Nothing else.

## analyze-offer-vision (deep lane)

Goal: the model SEES the card — route shape, map, badges OCR can't read.
Slower than text; the data-collection lane ("this will tell us where pings and
patterns happen" — Melody, 2026-07-02).

| # | Action | Settings |
|---|--------|----------|
| 1 | Take Screenshot | |
| 2 | *(optional)* Save to Camera Roll | album "Uber rides" |
| 3 | Get Contents of URL | POST, body **Form** — fields below |
| 4 | Get Dictionary Value | key `notification` |
| 5 | Show Notification | body: Dictionary Value |
| 6 | Get Dictionary Value | key `voice` |
| 7 | Speak Text | text: Dictionary Value (step 6) |

**Step 3 form fields:**

| Field | Value |
|-------|-------|
| `image` | Screenshot — **field type File**, not Text (raw bytes; server base64s in <1ms) |
| `source` | `siri_vision` (literal) |
| `device_id` | friendly label (optional) |

**Step 3 headers:** `X-Shortcut-Token` = the `vp_…` token. Nothing else.

**No OCR actions, no `text` field** — pure vision.

## Joint decisions baked into these specs (2026-08-14)

1. **No Get Current Location in either shortcut.** The location fix costs
   seconds (deadly in the 3-second Match window) and stalls on permission.
   Pattern data comes from Phase-2 server-side geocoding of the offer's own
   pickup/dropoff addresses. (Extends Melody's 2026-07-03 vision-only doctrine.)
2. **`source` exact keys:** `siri_text` / `siri_vision` (stored verbatim in
   `offer_intelligence.source`; Android equivalents will get their own keys
   under todo #43).
3. **Token in the real Headers section** (proven to work in the 2026-08-14
   decode — Melody's header slot was correct).

## Findings from the 2026-08-14 decode of live "Analyze 2" (9 actions)

1. **No `image` field existed** — screenshots were captured, saved, OCR'd, and
   never uploaded. Every live verdict to date (including the Siri-vs-ours A/B
   validation, todo #43) came from the TEXT path alone. Vision was live-unused.
2. **Junk rows in the Headers section**: `text` (entire OCR output as an HTTP
   header), `latitude`, `longitude` — body fields entered into the headers
   dictionary. Harmless server-side (ignored) but fragile; removed in the
   canonical specs.
3. **`lattitude` typo persisted in the body** (headers section ironically
   spelled it right). Now handled forever by the alias table; canonical specs
   drop coordinates entirely (decision 1).
4. **Token was present and correct** in headers — per-driver rules genuinely
   applied to the live verdicts.
5. Response wiring read only `notification` (spoken AND shown); canonical
   specs use `voice` for speech (the speech-optimized string,
   `formatPerMileForVoice`).

## Setup-card content requirements (todo #10, task 5)

- Install links for BOTH canonical shortcuts once Melody shares them.
- Required permissions on first run: Screen capture, Photos (add-only, only if
  the save-to-album step is kept), network access to vectopilot.com.
  **No Location permission needed.**
- **Accessibility triggers** (hands-free while driving — Melody's requirement):
  - Settings → Accessibility → Touch → **Back Tap** → Double/Triple Tap
  - iPhone 15 Pro+ **Action Button** → Shortcut
  - **"Hey Siri, analyze offer text"** (works by shortcut name)
  - AssistiveTouch single-tap assignment (one on-screen floating button)
