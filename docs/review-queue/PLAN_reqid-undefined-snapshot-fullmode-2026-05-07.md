# PLAN: Fix undefined `reqId` in `/snapshot` full-mode validation error path

**Created:** 2026-05-07
**Author:** Claude Code (Opus 4.7)
**Filed under:** Rule 1 (Planning Before Implementation), Rule 9 (zero-tolerance drift)
**Scope:** ONE handler — `POST /api/location/snapshot` at `server/api/location/location.js:1549`
**Status:** Awaiting advisor validation, then Melody approval (pre-approved per her message 2026-05-07).

---

## 1. Background

Audit finding from this session: `server/api/location/location.js:1718, 1720` reference `reqId` inside the SnapshotV1 full-mode validation error path, but `reqId` is not declared in any reachable scope. Trigger: client `POST`s to `/api/location/snapshot` with a full SnapshotV1 body (i.e., `coord` is set, putting the handler in the `else` branch at line 1705) and the validator at line 1710 fails (missing `snapshot_id`, missing `coord.lat/lng`, missing `resolved.timezone`, or missing both `resolved.city` AND `resolved.formattedAddress`).

When that path executes, the handler emits `console.warn` with `req_id: reqId` and calls `httpError(res, 400, ..., reqId, {...})` — both reference the undeclared identifier. JavaScript's identifier resolution falls through to global scope, finds nothing, throws `ReferenceError: reqId is not defined`. The intended structured 400 response (`refresh_required`, `fields_missing` guidance) never reaches the client; instead, the request 500s through Express's default error handler. The bug **inverts the failure mode** — a designed client-error becomes an undesigned server-error.

Same forensic class as the `thinkingLevel = high` Coach-breaking ReferenceError fixed in commit `daa430f3`: lint-clean, typecheck-clean, build-clean, only fires at runtime when a specific code path executes.

### Codebase audit for siblings

`grep -rn "reqId\|req_id"` across `server/api` confirms **this is the only broken instance**. Two styles coexist intentionally elsewhere:

| File:line | Style | Notes |
|---|---|---|
| `server/api/location/snapshot.js:35` | option-a (declares `const reqId = crypto.randomUUID()`) | Sister snapshot handler; the original pattern this file was likely copied from |
| `server/api/location/location.js:2125` | option-b (uses `req_id: cid`) | Different handler in same file, made a conscious choice to reuse `cid` |
| `server/api/location/location.js:1549` (this fix) | **broken** — references `reqId` without declaration | Caught mid-pattern; copy-paste from `snapshot.js` that missed the declaration |

The handler in question was clearly trying to follow option-a (per `snapshot.js`). The fix matches that original intent: add what was skipped.

---

## 2. Objectives

- **O1.** Eliminate the runtime `ReferenceError` on the SnapshotV1 full-mode validation-failure path.
- **O2.** Restore the intended client-facing error contract (structured 400 with `refresh_required` code and `fields_missing` payload) that the handler was designed to emit.
- **O3.** Match the convention already established in the sister `server/api/location/snapshot.js` handler — same kind of endpoint, same error-response shape, same per-request identifier semantics.

---

## 3. Recommendation (decision rationale, since Melody asked which option)

**Option (a): declare `const reqId = crypto.randomUUID();` at the top of the handler.**

Three reasons it wins on quality before consistency enters:

1. **Response-field naming integrity.** The JSON output field is literally `req_id`. It should carry a per-request identifier, not a cross-request correlation identifier. Putting a `cid` value into a field named `req_id` is a small but real semantic drift — every future debugger reads the JSON and assumes the field's value is per-request when, under option-b, it isn't.
2. **`cid` reuse risk.** `cid` is sourced from `req.cid || req.get('x-correlation-id') || crypto.randomUUID()` (line 1550). The first two branches mean the value can be supplied by the client. A retrying client that reuses `x-correlation-id` will collide on `cid`. `reqId` (freshly generated per handler invocation) is collision-immune by construction. For the **error path** specifically — where unambiguous log correlation matters most — the freshness guarantee is load-bearing.
3. **Bug origin and fix shape.** This was a copy-paste from `snapshot.js:35` that missed the declaration line. The fix that honors original intent is to add the declaration; the fix that refactors the surrounding pattern (option-b) is a wider scope than the bug warrants.

Option (b) — using `cid` in place of `reqId` — is defensible (one-identifier-per-request is simpler state) but loses on points 1 and 2 above, and requires touching two references rather than adding one line.

**Decision: option (a).**

---

## 4. Approach

### 4.1 Patch shape

Current (line 1549-1562 region):
```javascript
router.post('/snapshot', validateBody(snapshotMinimalSchema), async (req, res) => {
  const cid = req.cid || req.get('x-correlation-id') || crypto.randomUUID();
  res.setHeader('x-correlation-id', cid);

  // Import ndjson and getAgentState
  const { ndjson } = await import('../../logger/ndjson.js');
  ...
```

After:
```javascript
router.post('/snapshot', validateBody(snapshotMinimalSchema), async (req, res) => {
  const cid = req.cid || req.get('x-correlation-id') || crypto.randomUUID();
  const reqId = crypto.randomUUID();
  res.setHeader('x-correlation-id', cid);
  res.setHeader('x-req-id', reqId);

  // Import ndjson and getAgentState
  const { ndjson } = await import('../../logger/ndjson.js');
  ...
```

Two added lines:
1. `const reqId = crypto.randomUUID();` — fresh per-request identifier, in scope for the entire handler so the references at lines 1718 and 1720 resolve correctly.
2. `res.setHeader('x-req-id', reqId);` — exposes the identifier to the client in the response header, matching `snapshot.js:36`. This makes the value useful for client-side debugging (the client can include `x-req-id` in support reports), not just server-side logs.

### 4.2 No other changes needed

- Lines 1718 (`req_id: reqId` in console.warn) and 1720 (passing `reqId` to `httpError`) **stay as-is**. They're already correct against the new declaration.
- No changes to `httpError`'s signature or to any other handler.
- No changes to `snapshot.js` — that handler is already correct.
- No changes to the `location.js:2125` handler — that one made a different valid choice (option-b) and isn't broken.

### 4.3 Cascade rule

Per the rule established 2026-05-06: no `// 2026-05-07: added reqId because ...` breadcrumb comment in live source. The plan, the commit message, and the LESSONS_LEARNED entry carry the historical record. The added lines are self-documenting against `snapshot.js:35-36`.

---

## 5. Files affected

- `server/api/location/location.js` — **+2 lines** (one `const`, one `setHeader`).
- `LESSONS_LEARNED.md` — add a 2026-05-07 entry on the copy-paste-missed-declaration anti-pattern, paired with the `thinkingLevel = high` precedent from `daa430f3`.
- `claude_memory` — file an audit row, status `resolved` on commit. Parent: row 318 (same audit-class as the broader cross-user fixes from this session, since this bug also lives in a `:snapshotId`-adjacent handler).

That is the **entire** code-side surface area. Smallest possible diff that closes the bug.

---

## 6. Risk analysis

| Risk | Severity | Mitigation |
|---|---|---|
| The fix introduces a new failure mode I haven't predicted | Very low | The added `crypto.randomUUID()` cannot fail — `crypto` is already imported and used at line 1550. The `setHeader` call cannot fail because `res` is the standard Express response object with `setHeader` method. |
| Existing clients depend on the absence of an `x-req-id` response header | Very low | New headers are additive. No client breaks because a new optional header appeared. |
| The fix changes the value of `req_id` in the response body for clients that successfully exercise the unhappy path today | None | Today's unhappy path **doesn't return a response body** — it crashes with `ReferenceError`. There is no current `req_id` value to compare against; the field was never reaching clients. The fix takes us from "crash" to "structured 400 with a per-request UUID," which is strictly better. |
| There are MORE undeclared identifier references in this handler that this fix doesn't catch | Low | Verified via grep across server/api: `reqId` is referenced exactly twice in `location.js`, both at lines 1718 and 1720. No other undeclared references match this pattern. The grep used was `grep -rn "reqId\|req_id"` which would have surfaced any other site. |
| ESLint should have caught this; configuration may be insufficient | Medium | This is a meta-observation about CI hygiene, not a risk to this fix. Out of scope for this commit; flag as a follow-up: verify ESLint's `no-undef` rule is enabled and exercises arrow-function bodies. |

---

## 7. Implementation order

1. Edit `server/api/location/location.js:1549-1551` region: insert the two lines per §4.1.
2. `node --check server/api/location/location.js` — syntax sanity.
3. `npm run build` — verify clean.
4. Update `LESSONS_LEARNED.md` per §5.
5. File `claude_memory` audit row.
6. Stage only the touched files (`server/api/location/location.js`, `LESSONS_LEARNED.md`, the new plan file). Leave any pre-existing dirty-tree state untouched.
7. Commit. Push deferred until Melody confirms smoke test passes.

**Note on lint:** `npm run lint` covers only `client/src` (`eslint client/src --max-warnings 0` per `package.json`). Server JS — including this file — is not linted today. That's why this `ReferenceError` and the `thinkingLevel = high` ReferenceError in `gemini-adapter.js` (commit `daa430f3`) both passed CI. Adding ESLint coverage to `server/` with `no-undef` enabled would have caught both at PR time. Filed as a follow-up, separate plan, separate commit.

---

## 8. Test cases

### 8.1 Behavioral

- **T1 (full-mode happy path):** `POST /api/location/snapshot` with a valid full SnapshotV1 body — `coord.lat/lng`, `resolved.timezone`, `resolved.city`, `snapshot_id` all present. Expect 200 (or whatever the success path returns). The error path is not exercised; the fix should be invisible.
- **T2 (full-mode validation failure — the bug-trigger path):** `POST /api/location/snapshot` with a full-mode body missing `resolved.timezone`. Expect:
  - HTTP 400, NOT 500.
  - JSON body shape: `{ ok: false, error: 'refresh_required', message: 'Please refresh location permission and retry.', req_id: '<some uuid>', fields_missing: ['resolved.timezone'] }`.
  - Response header `x-req-id` matches the body's `req_id` value.
  - Server log emits the warn line (`[SNAPSHOT] INCOMPLETE_SNAPSHOT_V1...`) with the same `req_id` value.
- **T3 (full-mode validation failure — alternate fields):** Same as T2 but missing `coord.lat`. Verify `fields_missing: ['coord.lat_lng']`.
- **T4 (minimal-mode unaffected):** `POST /api/location/snapshot` with only flat `lat`/`lng`. Goes through the `isMinimalMode` branch (line 1583), not the validation-failure branch. Behavior is unchanged.
- **T5 (no client-facing breakage):** Existing clients that don't read `x-req-id` continue to work. The new header is additive only.

### 8.2 Static / sweep

- **T6 (lint):** `npm run lint` clean. (Note: server JS isn't linted today; passing/failing isn't useful signal for this fix. See §7 note.)
- **T7 (build):** `npm run build` clean.
- **T8 (residue grep):** `grep -nE "reqId" server/api/location/location.js` shows references at the call sites AND a `const reqId = ...` declaration in the handler scope. No bare references remain.
- **T_pre (curl, pre-fix evidence — captured 2026-05-07):** Confirmed live bug reproduction. With a fresh JWT and User-Agent, `POST /api/location/snapshot -d '{"coord":{"lat":33.1,"lng":-96.8},"resolved":{}}'` returns: `{"ok":false,"error":"snapshot_failed","message":"reqId is not defined","req_id":"<some uuid>"}`. The `message` field bleeds the `ReferenceError` to the client — secondary observation, see §6 risks update.

### 8.3 Regression (broader)

- **T9 (sister handler unchanged):** `POST /api/snapshot/...` (the route in `snapshot.js`) behavior is identical pre/post-fix. We didn't touch that file.
- **T10 (other handler unchanged):** The location.js handler at line 2125 (`req_id: cid` shape) is also untouched.
- **T11 (`httpError` signature contract):** Verify `httpError` is still called with the documented argument order at this site and that the response shape matches its emission contract (`{ ok: false, error: code, message, req_id: reqId, ...extra }`).

---

## 9. Open questions

None.

---

## 10. Outcome measures

- ✅ T2 passes (the bug-trigger path now returns a structured 400 instead of crashing).
- ✅ Bare `reqId` references no longer appear in `location.js` without a same-scope declaration (T8 grep).
- ✅ Lint + build clean.
- ✅ `LESSONS_LEARNED.md` entry filed.
- ✅ `claude_memory` audit row filed and marked `resolved`.

---

## 11. References

- Audit finding (this session, 2026-05-07): undefined `reqId` in `/snapshot` full-mode validation error path.
- Sister handler precedent: `server/api/location/snapshot.js:35-36`.
- `httpError` helper signature: `server/api/utils/http-helpers.js:1`.
- Forensic-class precedent: `daa430f3` (`thinkingLevel = high` Coach-breaking ReferenceError fix). Same shape — silent at module-load, fires at runtime in a code path that lint/typecheck don't exercise.
- Cross-user / ownership audit chain: rows 318 (audit), 319 (resolution), 320 (residue cleanup), 321 (snapshot ownership). This bug is a sibling of that chain in the same file.
