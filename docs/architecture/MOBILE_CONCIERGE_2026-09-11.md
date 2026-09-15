# Mobile entry and anonymous concierge — September 11, 2026

Provenance: implemented from Melody's September 11 must-haves. Existing schema,
stored profiles, driver share tokens, and prior candidate work are preserved.

## Anonymous guest boundary

- `/c` assigns a server-signed random bookmark token and navigates to `/c/:token`.
  The token carries no user/profile identifier, coordinates, or expiry timestamp.
  Browser storage retains only the concierge token; bookmark URLs also reopen it.
  Changing the deployment signing secret invalidates old bookmarks. No database
  schema, anonymous user row, or driver lookup is required.
- App does not mount AuthProvider, LocationProvider, or CoPilotProvider on `/c`
  paths. A driver already signed in in that browser does not connect their account
  to the guest view. Concierge requests omit browser credentials.
- The public session/profile response exposes only anonymous status. Legacy driver
  token, profile preview, and feedback endpoints return 410 without modifying their
  stored rows. Sharing QR codes now point to generic `/c`; guests get separate tokens.
- Guests explicitly request precise GPS. The shared coordinate boundary enforces
  range, six decimal representation, freshness, and sensor accuracy policy. The
  API independently validates coordinates and resolves timezone from coordinates;
  client timezone text is not trusted and UTC is not a fallback.
- UI follows Coach's gradient header, light/dark surfaces, and natural transcript.
  Chat is not associated with a driver or restored from the bookmark. Existing
  per-IP rate limits still apply. Model/local-discovery services remain separate
  from driver Coach data and authentication.

## Quick offer entry

- `/co-pilot/analyze` uses the signed-in account's shortcut token and the existing
  offer hook. Selecting a screenshot requests a fresh precise GPS fix, sends the
  screenshot with six-decimal coordinate fields, and speaks the server response.
- ACCEPT/REJECT is displayed/spoken only when `personal_rules_verified` is true,
  `analyzed_at` is current (30 seconds, maximum five-second future skew), and the
  voice starts with the matching decision. Otherwise the UI says NO DATA and asks
  the driver to decide manually when safe. Current results expire after 30 seconds
  and their replay button is disabled.
- SetupCard now supplies the same-deployment quick entry, iPhone/Android home-screen
  instructions, a downloadable text guide, and an actual HTTP Shortcuts Android
  browser-launcher JSON import file without account tokens. The existing
  iCloud shortcut is explicitly legacy and requires configuration/device testing.
- This completes a browser screenshot-picker flow. It does **not** implement
  unattended cross-app capture, a signed/published new iOS shortcut, or an Android
  native one-tap screenshot artifact. Native phone testing remains outstanding.
  Browser speech may require a further user gesture; the replay button and visible
  audio error preserve an honest recovery path.

### Android launcher artifact and native upload boundary

`createAndroidLauncher(window.location.origin)` generates
`Vecto-Android-launcher.json` entirely in the browser. It has HTTP Shortcuts schema
version 91 / compatibility 90 and a `browser` execution shortcut pointing to the
same deployment's `/co-pilot/analyze`. It exports no account token, user ID,
coordinates, global variables, or executable script. Category/shortcut IDs are
omitted so a normal import assigns new IDs instead of replacing existing entries.
HTTPS is required except for loopback development origins; userinfo, paths,
queries, and fragments are rejected as origin inputs.

The JSON shape and browser execution behavior were checked against the official
**v4.6.0** source on 2026-09-11:

- [Import version constants](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/import_export/ImportExport.kt)
- [Importer, including direct JSON fallback](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/import_export/Importer.kt)
- [Import shortcut model](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/import_export/models/ImportExportShortcut.kt)
- [Import category model](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/import_export/models/ImportExportCategory.kt)
- [Browser execution implementation](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/activities/execute/types/BrowserExecutionType.kt)
- [User import instructions](https://http-shortcuts.rmy.ch/import-export)

After importing with the app's normal Import / Export action, the driver can add
the launcher to their home screen. It opens the guarded browser flow; screenshot
selection and browser sign-in remain necessary. The generated artifact is covered
by contract tests, **not** certified by an Android-device import test. A new signed
iPhone `.shortcut` has not been produced; the iPhone option remains Safari's
documented Add to Home Screen flow.

A native HTTP Shortcuts screenshot POST was investigated and deliberately not
shipped. The app can select a multipart file and speak a result, but its
[GetLocationAction](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/scripting/actions/types/GetLocationAction.kt)
returns latitude, longitude, and accuracy **without the fix timestamp**. Its
[LocationLookup fallback](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/main/kotlin/ch/rmy/android/http_shortcuts/utils/LocationLookup.kt)
can accept fixes up to five minutes old; the
[Google Play implementation](https://github.com/Waboodoo/HTTP-Shortcuts/blob/v4.6.0/HTTPShortcuts/app/src/withGoogleServices/kotlin/ch/rmy/android/http_shortcuts/utils/PlayServicesUtilImpl.kt)
requests a current location but still discards its timestamp before exposing it to
scripts. Therefore this API cannot enforce Vecto's 30-second freshness boundary.
Assigning the script's current time to the result would fabricate fix freshness.
The browser launcher preserves the validated GeolocationPosition timestamp and
accuracy checks. A future native uploader requires a location API exposing the
actual fix time, plus a physical-phone screenshot/voice test.

Platform instructions checked against
[Apple's Home Screen guide](https://support.apple.com/en-kw/guide/iphone/iphea86e5236/ios)
and [Chrome's Android website shortcuts guide](https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&hl=en).

## Navigation retirement

- Translation tab/help entry removed; old `/co-pilot/translate` redirects to Coach.
- Donation links/routes no longer expose Square; old routes redirect to the main
  app or welcome page. Legacy source files/data are retained, unmounted.
- Welcome's Uber rating/payment QRs are removed; its guest concierge QR remains.
- No verified Venmo recipient exists in the repository. No recipient or payment
  destination was invented; the coffee-support link awaits Melody's real Venmo URL.
- Holiday greeting code was not changed by this slice.

## Verification

- `tests/concierge-anonymous.test.js`: signed bookmark tamper rejection, secret
  rotation, identity-free response, retired endpoints, no model calls before token
  validation, server-resolved timezone, invalid/zero coordinate cases.
- `tests/concierge-provider-isolation.test.tsx`: a bookmarked guest route does not
  mount any driver provider, including with an existing synthetic driver session.
- `tests/offer-capture.test.ts`: verified saved/signup rules, missing verification,
  stale/future/malformed timestamps, missing audio, contradictory spoken verdict.
- `tests/android-launcher.test.ts`: pinned export shape, guarded browser route,
  absence of account-bearing fields, rejection of insecure or account-bearing
  origins, and loopback preview port preservation.
- Isolated loopback fixture: `node scripts/test-mobile-concierge-preview.mjs`.
  Actual guest App is exercised at `/c`; quick analyzer and SetupCard have independent
  fixture entries at `/fixture/quick` and `/fixture/setup`. Coordinates `(0,0)` and
  all API/speech replies are synthetic; no real GPS, AI, or database is used.
  Browser artifacts and API request receipt are in `test-results/mobile-concierge/`.
  A synthetic screenshot upload showed REJECT, personal-rule version 3, timestamp,
  and matching speech; its later EXPIRED state disabled replay. Guest chat streamed
  a reply and the request log contained no driver/auth/snapshot calls for that flow.
- Phone-width visual review found and corrected dark-mode button/text contrast.
  The setup-guide button generated a 578-byte `.crdownload` file in desktop Edge;
  the browser completion event timed out. Completed native phone downloads/installation
  are **not** verified. No browser security setting was changed.

No commit, push, merge, migration, or deployment was performed by this slice.
