# SIRI_SHORTCUT_ANALYZE.md — "Analyze 2" Shortcut ground truth

> **Provenance:** Shortcut authored by Melody; anatomy decoded by Claude 2026-07-03
> from the shared iCloud link (parsed the actual plist — not inferred).
> **Share link (canonical, for the Setup card):**
> https://www.icloud.com/shortcuts/cce34c892b394d3fb3e5cebd19f317c5
> Shortcut name: **"Analyze 2"** · 11 actions · decoded plist archived in session
> scratchpad; re-decode any time via the API:
> `curl -s https://www.icloud.com/shortcuts/api/records/<id>` → `fields.shortcut.value.downloadURL` → binary plist.

## Action graph (verbatim from plist)

| # | Action | Detail |
|---|--------|--------|
| 0 | Take Screenshot | output UUID feeds 1 & 2 |
| 1 | Save to Camera Roll | album **"Uber rides"** |
| 2 | Extract Text from Image | on-device OCR of the screenshot |
| 3 | Combine Text | newline-joined OCR lines |
| 4 | Get Current Location | accuracy **Best** |
| 5 | Get Contents of URL | **POST** `https://vectopilot.com/api/hooks/analyze-offer`, body type **Form** (multipart) |
| 6–8 | Get Dictionary Value | `notification`, `decision`, `voice` from response |
| 9 | Show Notification | body = `notification` |
| 10 | Speak Text | voice **Alex**, pitch 1.27 = `voice` |

## POST body fields (action 5)

| Field | Value | Server reads (analyze-offer.js) |
|-------|-------|--------------------------------|
| `text` | Combined OCR text | `req.body.text` ✅ |
| `device_id` | literal `Melody's Iphone` (curly apostrophe U+2019) | `req.body.device_id` ✅ |
| `lattitude` | Current Location.Latitude | ⚠️ **server reads `latitude` (:206,:213) — MISMATCH, GPS silently null** |
| `longitude` | Current Location.Longitude | `req.body.longitude` ✅ |
| `source` | `siri_shortcut` | `req.body.source` ✅ |

Headers: one **empty key/value row left open by Melody** — reserved slot for
`X-Shortcut-Token` (identity bridge, todo #10).

## Findings (2026-07-03)

1. **`lattitude` typo drops GPS silently.** Every request from this shortcut lands
   with `driver_lat/driver_lng = null` in `offer_intelligence`. Fix in the shortcut
   (rename key) AND accept the alias server-side with a warn log (fail-loud: never
   silently null a provided coordinate).
2. **Text-only today; vision requires one edit.** The screenshot is saved + OCR'd
   but never uploaded. The endpoint already accepts a multipart file field named
   `image` (multer, `analyze-offer.js:189`) → base64 → Gemini vision. Adding a form
   field `image = Screenshot` upgrades the shortcut to Vision+OCR (Melody's Data
   Priority rule: Vision > OCR > estimate).
3. **`device_id` is a human label, not a device identifier.** Identity today is the
   string "Melody's Iphone". The shortcut-token bridge (todo #10) supersedes this as
   the identity key; `device_id` stays as a display label.

## VISION-ONLY contract (Melody, 2026-07-03 — supersedes the OCR flow above)

> "We won't need anything extracted … the shortcut will just send the screenshot
> and technically the address is on the offer … with vision we don't have to
> overthink even getting current location."

The canonical Shortcut becomes **4 actions**: Take Screenshot → (optional) Save
to "Uber rides" album → Get Contents of URL (POST) → Notification + Speak.
**Removed:** Extract Text (OCR), Combine Text, Get Current Location — the offer
card itself shows pickup distance/time from the driver's position, and dropping
the Location action removes its permission stall (seconds, deadly in the
3-second Match window).

**POST body (Form/multipart) — the server contract (verified live 2026-07-03):**

| Field | Value |
|-------|-------|
| `image` | Screenshot (file field — raw bytes; server handles base64) |
| `device_id` | friendly label (display only; identity is the token) |
| `source` | `siri_vision` |

**Header:** `X-Shortcut-Token: vp_…` — from the Offer Analyzer page's Setup card
(the empty header row Melody left open is exactly this slot). Also accepted as a
`shortcut_token` form field. No token → default rules + anonymous row.

Server tolerances kept for old installs: `lattitude` (double-t) accepted with a
warn log; text-only and text+image requests still work (full backward compat).

## Setup-card content requirements (todo #10, task 5)

- iCloud install link (above) + "Add Shortcut" walkthrough (Melody will share a
  vision-only "Analyze 3" once edited; the anatomy above is the edit guide).
- Required permissions on first run: Screen capture, Photos (add-only, if the
  save-to-album step is kept), network access to vectopilot.com. **No Location
  permission needed** in the vision-only flow.
- **Accessibility triggers** (hands-free while driving — Melody's requirement):
  - Settings → Accessibility → Touch → **Back Tap** → Double/Triple Tap → "Analyze 2"
  - iPhone 15 Pro+ **Action Button** → Shortcut → "Analyze 2"
  - **"Hey Siri, Analyze 2"** (works by shortcut name)
  - AssistiveTouch single-tap assignment (one on-screen floating button)
- Edit instructions (vision-only): delete the Extract Text / Combine Text /
  Get Current Location actions; add form field `image = Screenshot` (type File);
  put the token in the open header row as `X-Shortcut-Token`.
- Response now also carries `notices: []` (e.g. "Verified Rider", "Filter
  Detected", "Deadhead Reduction Pickup") when enabled in the driver's rules —
  already appended to the notification string, no Shortcut change needed.
