# Code removals — 2026-08-11 (per-user scoping sweep)

> Convention (Melody, 2026-08-11, dictated while driving): whenever code, features,
> or code comments are removed, the removed text is preserved here with the date and
> a short reason. Code stays clean and crisp; history stays traceable. One file per
> dated sweep, under `docs/architecture/removals/`.

Session: branch `todo10-offer-rules-editor`, per-user scoping fixes (Phase A of the
approved plan). App is multi-user now (~7-8 real drivers); every "single-user system
for now" assumption is being retired.

---

## 1. `server/lib/ai/rideshare-coach-dal.js` — `getOfferHistory()` doc comment

**Removed comment lines:**

```
 * Queries ALL recent offers (single-user system for now).
 * Future: link device_id → user_id for multi-user support.
```

**Reason:** The "future" arrived 2026-07-03 when `offer_intelligence.user_id` was
added; the comment described (and excused) a live cross-user data leak — every
driver's Coach prompt contained every other driver's offers, addresses included.
The function now requires a `userId` and filters on it; no-user returns empty,
never the global log.

## 2. `server/lib/ai/rideshare-coach-dal.js` — `getOfferHistory` call site comment

**Removed comment:**

```
this.getOfferHistory(20),  // 2026-02-16: Include offer analysis history
```

**Reason:** Dated inline note superseded by the scoped call
`this.getOfferHistory(effectiveUserId, 20)`.

## 3. `server/api/chat/realtime.js` — inline ownership check + its history comment

**Removed:** the 26-line inline snapshot-ownership block (db select on `snapshots`,
403 `snapshot_not_owned`, 500 `ownership_check_failed`) plus its comment:

```
// 2026-04-25 (audit §1.5): Ownership check moved BEFORE the OpenAI mint.
// Previously the order was auth → mint → ownership, which meant a billed
// OpenAI token could be issued for a snapshot the caller did not own —
// even if the response was withheld, the cost had already been incurred.
```

Also removed now-unused imports: `db`, `snapshots`, `eq`.

**Reason:** Consolidated into the pre-existing
`server/middleware/require-snapshot-ownership.js` (P0-4 policy: 404 anti-enumeration,
NULL-owned rows rejected), which gained an exported `verifySnapshotOwnership()` core
for routes whose snapshot id arrives in body/header/query. Applied to four routes
that had no check (`chat.js` GET context + POST chat, `chat-context.js`,
`content-blocks.js` — the last closes todo #31). **Contract change in realtime.js:**
ownership mismatch now returns 404 `snapshot_not_found` (was 403 `snapshot_not_owned`)
— aligned to the anti-enumeration policy; the route has no live client callers
(Phase C scaffold). The mint-order lesson lives on in the route's comment.

## 4. `server/api/hooks/analyze-offer.js` — the 18-line auth-deferral TODO block

**Removed comment (abridged; full text in git history at this file's blame):**

```
// TODO(auth-hardening Item 7, deferred 2026-05-13): treatment (B) — this
// router is intentionally left unauthenticated pending Siri Shortcut
// migration to user_id auth. … The plan: migrate the Siri Shortcut to attach
// a per-user token, then layer requireAuth here in a separate commit.
// HooksCatalog.md additionally flags … an offerHookLimiter …
```

**Reason:** The deferral is now (partially) executed, so the TODO became stale
doctrine: the per-user shortcut token IS the auth on offer-history / offer-override /
offer-cleanup (required), `offerHookLimiter` now exists in
`server/middleware/rate-limit.js` and guards all four routes. `/analyze-offer`
itself stays token-optional deliberately — an untokened legacy Shortcut still gets a
voice decision; its offer just isn't stored per-user. Replaced by a 5-line current-state
comment.

## 5. `server/api/hooks/analyze-offer.js` — device_id-as-ownership behavior

**Removed behavior + comments:**

- `offer-history`: `device_id` query param requirement and `WHERE device_id = …`
  ("no auth required (device_id based)").
- `offer-override`: `WHERE id AND device_id` with comment
  `// 2026-02-15: Only allow the same device to override its own analyses`.
- `offer-cleanup`: `device_id` body validation + `WHERE … AND device_id` with the
  2026-03-17 F-3 comment (`Require device_id ownership scope`).
- Response field `device_id` dropped from offer-history payload.

**Reason:** A device id is an iOS Shortcut form field, not a credential — anyone
could read/override/delete any device's offers. All three now require the shortcut
token and scope strictly by `user_id`. F-3's narrowing (2026-03-17) was a step;
this completes it. Breaking change for any untokened caller of these three
endpoints — acceptable: the app client never called them, and Melody's Shortcut
carries the token.

## 6. `server/api/hooks/analyze-offer.js` — `'anonymous_device'` session stitching

**Removed behavior:** session-chain lookup keyed on `WHERE device_id = ${deviceId}`
where `deviceId` fell back to the literal `'anonymous_device'`.

**Reason:** All untokened, deviceless drivers shared one literal bucket, stitching
different people into a single `offer_session_id` sequence and poisoning
`seconds_since_last` (which Phase B's drought-fallback logic will read). Now chains
by `user_id` when tokened, by real `device_id` (with `user_id IS NULL`) otherwise,
and fresh-session when neither exists. The `device_id` column still stores
`'anonymous_device'` as a value (NOT NULL constraint); it just no longer drives
cross-row identity.

## 7. `server/api/rideshare-coach/schema.js` — stale offer_intelligence teaching note

**Removed text (from the schema doc the Coach LLM is prompted with):**

```
sample_query: "SELECT day_part, AVG(per_mile), COUNT(*) FROM offer_intelligence WHERE platform = 'uber' GROUP BY day_part"
notes: "No user_id FK — uses device_id (Siri headless). …"
```

**Reason:** The sample query taught the model an UNSCOPED aggregate over all
drivers' offers, and the note denied `user_id` exists (it has existed since
2026-07-03) — while the same file's scoping section claimed "All user-specific data
is filtered by authenticated user_id." Replaced with a user-scoped sample and an
explicit "ALWAYS filter by user_id" instruction, so the doc, the scoping claim, and
the (now-fixed) DAL all say the same thing.
