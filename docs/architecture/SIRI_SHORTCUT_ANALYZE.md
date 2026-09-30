# Offer Analyzer on iPhone

> Repository-source review: 2026-09-29. Current setup UI is
> `client/src/components/offer-analyzer/SetupCard.tsx`; browser capture is
> `client/src/pages/co-pilot/QuickAnalyzePage.tsx`. This is not a new iCloud-shortcut
> release or a physical-phone test. [Analyzer contract](OFFER_ANALYZER.md).

## Part 1 · Current browser setup

1. Sign in to the deployment you use and open **Offer Analyzer → Phone Setup**.
2. Review your selected services and saved rules. You can keep existing choices;
   setup does not require inventing new thresholds.
3. Choose **Open quick analyzer**. In Safari, use **Share → Add to Home Screen**
   while `/co-pilot/analyze` is the selected page.
4. Configure and test while stopped. Opening the icon takes you to Vecto; choose a
   current JPEG, PNG or WebP offer screenshot (at most 5 MiB), allow precise location
   and listen to the result. This flow cannot silently capture another app.
5. If speech cannot play, the page shows an audio error and **Speak result** control.
   Results expire after 30 seconds; an old result is not advice for a new offer.

The browser obtains the signed-in owner’s shortcut token internally. Its downloadable
setup guide contains no token. A personal-rule receipt, current timestamp and matching
spoken decision are required before the browser presents ACCEPT/REJECT. Missing or
unverified evidence produces a manual-decision message.

## Part 2 · Existing native iPhone screenshot automation

The SetupCard still links the legacy “Analyze 2” shortcut at
[iCloud](https://www.icloud.com/shortcuts/cce34c892b394d3fb3e5cebd19f317c5), explicitly
labeled as requiring configuration and a device check. Its presence in source does
not verify the current remote artifact or mean a new two-shortcut package was published.
Melody and Claude retain ownership of external shortcuts unless Melody changes it.

For an existing shortcut:

- Use the request URL shown by **your deployment’s** SetupCard, ending in
  `/api/hooks/analyze-offer`. Do not copy a different environment’s domain or token.
- Put the owner token in the actual `X-Shortcut-Token` header. Keep it out of shared
  shortcut exports. Rotate it on the Analyzer page if it was exposed.
- Use canonical field names. The server tolerates legacy `lattitude`, but the correct
  name is `latitude`. Fields such as OCR text belong in the body, not HTTP headers.
- Speak the returned `voice`; show `notification`. Notification formatting is not a
  speech contract. Handle HTTP errors instead of speaking an old dictionary value.
- Adding image input means a multipart **File** field named `image` containing the
  current screenshot. Taking a screenshot and only sending its OCR is still text input.

Back Tap, Action Button, Siri by shortcut name and AssistiveTouch are possible configured
shortcut triggers described in the setup UI. Their availability and exact menu labels
depend on the phone; they do not themselves certify capture, upload or speech.

## Part 3 · Agreed text and vision shortcut contracts

The August 14 joint design separated two capture modes. These are maintainers’ build
contracts, not an assertion that new shared artifacts have been installed.

| Step | Text shortcut | Vision shortcut |
|---|---|---|
| Capture | Current screenshot, then on-device OCR | Current screenshot |
| Request | JSON/URL-encoded `text`, or text form fields | Multipart File field `image`; base64 also accepted |
| Provenance | `source=siri_text` | `source=siri_vision` |
| Identity | `X-Shortcut-Token` header from the same deployment | Same |
| Result | Read response; display `notification`, speak `voice` | Same |

The agreed legacy direct shortcuts omit **Get Current Location** to avoid additional
capture delay. The browser flow in Part 1 separately requires GPS. Both text and vision
enter Phase 1 and can continue to Phase 2; “vision” does not mean “Phase 2 only.”
Do not skip judgment rules merely to shorten a text ACCEPT path.

## Part 4 · Verify before relying on a phone setup

Check real current offer cards while stopped: pickup versus trip legs, rate denominator,
chosen service, saved-rule behavior and matching speech. Also check a non-offer screen,
missing/invalid token, unavailable network, oversized screenshot and a delayed response.
Measure capture-to-speech as well as server `response_time_ms`.

| Symptom | Check |
|---|---|
| Rules cannot be verified | Correct deployment/token; saved rule load and service-selection state. Unknown supplied tokens fail closed, not to anonymous defaults. |
| No screenshot reaches the server | Multipart file part named exactly `image`; OCR-only bodies do not contain a screenshot. |
| Request rejected with 413 | Screenshot/body exceeds the 5 MiB limit; the server returns a manual-decision shape. |
| Response is NO DATA | Evidence/rules could not support a verdict; do not reuse an earlier acceptance. |
| Spoken answer differs from the screen | Speak `voice`, not a recomposed decision or `notification`; report the mismatch. |
| Decision heard, history missing | Enrichment/storage is later and may fail; unresolved trusted timezone also prevents storage. A response is not a storage receipt. |

## Part 5 · Server reference

See [canonical §4](OFFER_ANALYZER.md#4-ingest-endpoint-contract--post-apihooksanalyze-offer)
for transports, alias/identity behavior and response provenance, and §10 for enrichment.
No token means anonymous defaults with personal rules unverified. Companion history,
override and cleanup hooks require a resolving owner token.

## Part 6 · Historical decisions and evidence

The August 14 decode of Melody’s then-current nine-action “Analyze 2” found that it
captured/OCR’d but did not upload an image; used misplaced text/location header entries;
carried the `lattitude` typo; did have the owner token; and spoke `notification` rather
than `voice`. Text-only Form requests needed the URL-encoded body parser added that day.
The older eleven-action July artifact is the distinct iCloud ID still in SetupCard.
These explain the capture contracts; they are not a fresh decode of a remote shortcut.

The joint design selected text/vision names, canonical source tags and token headers,
and omitted direct-shortcut GPS. Preserve that decision separately from the later
browser capture requirements. Detailed old recipes/timing receipts remain recoverable
from [the removal ledger](removals/2026-09-29-offer-analyzer-doc-reconciliation.md).
