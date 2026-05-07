# PLAN: Close snapshot-ownership gaps in `server/api/location/location.js`

**Created:** 2026-05-07
**Author:** Claude Code (Opus 4.7)
**Filed under:** Rule 1 (Planning Before Implementation), Rule 9 (zero-tolerance drift)
**Scope:** ONE file — `server/api/location/location.js` — two routes
**Status:** Awaiting advisor validation, then Melody approval.

---

## 1. Background

Audit finding requested by Melody on 2026-05-07: validate that `requireSnapshotOwnership` is applied to all snapshot enrichment and snapshot fetch routes.

**Result:** Two routes in `server/api/location/location.js` are gated by `requireAuth` (via `router.use(requireAuth)` at line 30) but **NOT** by `requireSnapshotOwnership`.

| # | Route | File:line | Status | Severity |
|---|---|---|---|---|
| R1 | `PATCH /api/location/snapshot/:snapshotId/enrich` | location.js:2294 | LIVE (called from `client/src/contexts/location-context-clean.tsx:594`) | HIGH — cross-user write |
| R2 | `GET /api/location/snapshots/:snapshotId` (plural) | location.js:2376 | DEAD (zero callers across server/client/scripts/tests) | latent IDOR-read |

The canonical singular `GET /api/snapshot/:snapshotId` route at `server/api/location/snapshot.js:220` IS properly gated (`requireAuth + requireSnapshotOwnership`). R2 is a duplicate of that canonical route with a different URL (plural) that bypasses the ownership gate. R1 has no canonical sibling — it's the sole enrichment endpoint.

### Why these slipped past prior audits

`location.js` applies `requireAuth` globally via `router.use(requireAuth)`, which is sufficient for routes that don't operate on a specific snapshot UUID. The moment a route in this file takes `:snapshotId`, it inherits a false sense of safety: `requireAuth` is there, but the snapshot-specific ownership check is missing. Sibling routers (`briefing.js`, `snapshot.js`) apply `requireSnapshotOwnership` per-route, which makes omissions visible during code review. In `location.js`, the per-route omission is invisible because every route looks identical at the declaration layer — only the path string changes.

This is the same class of audit-blindness that produced the cross-user `/resolve` bug: the actual identity check was missing while the route *looked* gated.

---

## 2. Objectives

- **O1.** Close R1 (enrich): block cross-user writes to `weather`, `air`, and `status` on snapshots that don't belong to the requester.
- **O2.** Close R2 (plural-snapshots fetch): eliminate the latent IDOR-read vector.
- **O3.** Make the `:snapshotId`-bearing routes in `location.js` look structurally consistent with the gated routes in `briefing.js` and `snapshot.js`, so future audits (human or AI) can spot omissions by visual scan.

---

## 3. Recommendation

**R1 (enrich): add `requireSnapshotOwnership`.**
- Live route, can't be deleted.
- Inline middleware addition is 1 line + 1 import (or reuse the existing `requireSnapshotOwnership` import if already present in the file).
- After the middleware runs, `req.snapshot` is populated by the middleware, which the handler can use as the existence check — collapsing 5 lines (the existence query at 2304-2312) into a freebie.

**R2 (plural-snapshots fetch): DELETE the route.**
- Zero callers, full duplicate of an already-gated canonical route at `/api/snapshot/:snapshotId`.
- Per the precedent set in commit `b8a6b637` for `shared/identity.ts`: dead code that contradicts the security model is a regression vector — the next contributor who reaches for it won't know it bypasses ownership. Deletion is the root-cause fix.
- Alternative (gate-not-delete) leaves a duplicate route sitting in the codebase, which is the worst of both worlds: maintenance surface area + duplicate routing + invitation to drift.

This pairing matches the principle Melody articulated on 2026-05-06: *"deleted, not re-targeted."*

---

## 4. Approach

### 4.1 Cascade rule (carrying over from PLAN_remove-device-id-cross-user-fix-2026-05-06.md §3.0)

When a route is deleted:
1. Delete the route handler outright.
2. Delete any comment block above it that referenced the route's purpose.
3. Do not leave a `// Removed YYYY-MM-DD: see PLAN_...` breadcrumb in live source. The git commit message and this plan are the historical record.

When middleware is added:
1. Place it inline on the route declaration (not via `router.use()`), so future audits can scan the route line and see all middleware applied.
2. If the handler had an existence-check query that the middleware now performs, delete that query and use `req.snapshot` (populated by the middleware) instead.

### 4.2 R1 patch shape

Current:
```javascript
router.patch('/snapshot/:snapshotId/enrich', async (req, res) => {
  try {
    const { snapshotId } = req.params;
    const { weather, air } = req.body;

    if (!snapshotId) { ... }

    // Verify snapshot exists
    const [existing] = await db
      .select({ snapshot_id: snapshots.snapshot_id })
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // ... build update payload, write, readiness gate, respond
```

After:
```javascript
router.patch('/snapshot/:snapshotId/enrich', requireSnapshotOwnership, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    const { weather, air } = req.body;

    // existence + ownership both validated by requireSnapshotOwnership;
    // req.snapshot populated for the handler.

    // ... build update payload, write, readiness gate, respond
```

Net diff: +1 import (if not already in file), +1 middleware token, -10 lines (existence query + null check + the `if (!snapshotId)` guard, since `requireSnapshotOwnership` handles missing snapshotId at line 22-26 of the middleware).

Note: `requireAuth` does NOT need to be repeated inline because `router.use(requireAuth)` at line 30 already applies it. Adding `requireSnapshotOwnership` after a global `requireAuth` works because Express runs middleware in order — the global one runs first, populating `req.auth.userId`, then the per-route one runs. This is consistent with how `briefing.js` is structured (global `requireAuth` is NOT applied there; both are inline per-route). The two patterns produce equivalent runtime behavior; we'll preserve the `location.js` structure to minimize diff.

### 4.3 R2 patch shape

Delete the entire `router.get('/snapshots/:snapshotId', ...)` block (lines 2374-2402, ~28 lines including the comment block at line 2374-2375). No replacement.

If any client tries to call `/api/location/snapshots/:snapshotId` after deletion, it returns Express's default 404 — same effect as the current 404-when-snapshot-not-found path, but now applied to the route shape itself.

### 4.4 Import dependency

`requireSnapshotOwnership` is exported from `server/middleware/require-snapshot-ownership.js`. Currently `location.js` imports `requireAuth` from `../../middleware/auth.js` at line 22 but does NOT import `requireSnapshotOwnership`. One new import line needed.

---

## 5. Files affected

- `server/api/location/location.js`
  - **+1 import** of `requireSnapshotOwnership`
  - **R1:** add middleware to `PATCH /snapshot/:snapshotId/enrich`; delete the existence-query block (lines 2304-2312); delete the `if (!snapshotId)` guard (lines 2299-2301); delete the comment "Verify snapshot exists" (line 2303).
  - **R2:** delete the entire `router.get('/snapshots/:snapshotId', ...)` block (lines 2374-2402) including the docstring comment immediately above (lines 2374-2375).

That is the **only** source file modified.

Documentation cascade (Rule 2):
- `LESSONS_LEARNED.md` — add a 2026-05-07 entry on the audit-blindness pattern (mixed middleware styles in same router) and the resolution.
- `claude_memory` — file an audit row noting the gap was discovered + closed in this commit. Status: `resolved` on landing.

---

## 6. Risk analysis

| Risk | Severity | Mitigation |
|---|---|---|
| Production users with in-flight calls to `PATCH /snapshot/:snapshotId/enrich` are mid-deploy and find their request rejected with 404 (mismatched owner) when ownership middleware lands | Low | The client at `location-context-clean.tsx:594` calls enrich for the user's own snapshot only — `snapshotId` comes from a snapshot the same client just received from `/resolve`. So all legitimate calls match `req.auth.userId === snapshot.user_id`. The middleware's 404-on-mismatch only fires for cross-user attempts, which is the bug being closed. |
| Some hidden caller of the dead `GET /snapshots/:snapshotId` (plural) route exists in code I didn't grep | Low | I grepped `--include="*.{js,ts,tsx,mjs}"` across server/client/scripts/tests for the URL substring `/api/location/snapshots/`. Zero hits. If a hidden caller exists in compiled output or external systems, it would 404 after deletion and surface immediately. |
| `requireSnapshotOwnership` middleware has a bug that breaks legitimate calls | Very Low | The middleware is already in production use on 9 routes (`briefing.js` x8 + `snapshot.js` x1). If it had a defect affecting same-owner reads/writes, briefing data would be broken in prod, which Melody's "everything is running smoothly" report contradicts. Reusing a battle-tested gate is lower-risk than writing a new one. |
| Dropping the existence-query in R1 changes error semantics: was returning 404 with `{ error: 'snapshot_not_found' }`, will now return 404 with `{ error: 'snapshot_not_found' }` (same shape, same status, same message — middleware uses identical wording) OR with `{ error: 'unauthorized' }` (401) if `req.auth.userId` is missing | None | Middleware's response shapes are documented at `server/middleware/require-snapshot-ownership.js:30-56`: 400 if no snapshotId, 401 if no auth, 404 if snapshot doesn't exist OR if ownership mismatches. The 404 case is identical wording to the current handler. The 401 case can't happen because `requireAuth` runs first via `router.use()`. Net: client experience is identical. |

---

## 7. Implementation order

1. Edit `server/api/location/location.js`:
   a. Add import for `requireSnapshotOwnership`.
   b. Apply middleware to the enrich route + remove the existence-check duplication.
   c. Delete the plural-snapshots route block + its comment.
2. `node --check server/api/location/location.js` (syntax sanity).
3. `npm run lint` (clean).
4. `npm run build` (clean).
5. Re-grep to confirm zero `:snapshotId`-bearing routes in `location.js` lack ownership middleware.
6. Update `LESSONS_LEARNED.md` per §5.
7. File `claude_memory` audit row, status `resolved`.
8. Stage only `server/api/location/location.js` + `LESSONS_LEARNED.md`. Do NOT touch any of the other files in the dirty tree (consistent with prior commits this session).
9. Commit. Push deferred to Melody.
10. Implementation gated on Melody's approval per Rule 1 ("All tests passed" confirmation after smoke testing).

---

## 8. Test cases

### 8.1 Behavioral

- **T1 (R1, same-owner happy path):** User A authenticates, calls `PATCH /api/location/snapshot/{A_snapshot}/enrich` with `{ weather: {...}, air: {...} }`. Expect 200, payload returns enriched fields and updated status. Verify A's `snapshots` row in DB has the new weather/air values.
- **T2 (R1, cross-user denied):** User A's snapshot UUID known. User B authenticates, calls `PATCH /api/location/snapshot/{A_snapshot}/enrich` with arbitrary weather/air payload. Expect 404 with `{ error: 'snapshot_not_found' }`. Verify A's row in DB is **unchanged**.
- **T3 (R1, missing snapshotId):** `PATCH /api/location/snapshot//enrich` (empty snapshotId) — Express routing returns 404 (no match). `PATCH /api/location/snapshot/INVALID/enrich` — middleware returns 404 with `snapshot_not_found`.
- **T4 (R1, no auth):** Call enrich without `Authorization` header. Expect 401 (caught by global `requireAuth`).
- **T5 (R2, route deleted):** `GET /api/location/snapshots/{any_snapshot_id}` returns Express's default 404 ("Cannot GET ..."). Verify no route handler runs.
- **T6 (canonical fetch still works):** `GET /api/snapshot/{my_snapshot_id}` (singular, sibling router) returns 200 for owner, 404 for non-owner — unchanged from before.

### 8.2 Static / sweep

- **T7 (lint):** `npm run lint` clean.
- **T8 (typecheck):** No new TS errors introduced (pre-existing maps-types errors are out of scope).
- **T9 (build):** `npm run build` clean.
- **T10 (residue grep):** `grep -nE "router\.(get|post|put|patch|delete)\s*\(\s*['\"][^'\"]*:snapshotId" server/api/location/location.js` returns only routes that have `requireSnapshotOwnership` on the same line (or in adjacent middleware tokens).

### 8.3 Regression (snapshot-touching pipeline)

- **T11 (briefing waterfall):** Sign in, accept GPS, hit `/resolve`, verify snapshot enrich call succeeds (T1 path), verify briefing → strategy → venues all run normally on top of the enriched snapshot.
- **T12 (status gate):** Verify the readiness-gate path at `location.js:2341` (REQUIRED_FIELDS check + status flip to `'ok'`) still runs — the middleware addition shouldn't change this code path's reachability.

---

## 9. Open questions

None. Both R1 and R2 have unambiguous resolutions per the recommendation in §3. If Melody prefers gate-not-delete on R2, the alternative is a one-line addition (`requireSnapshotOwnership`) on the route declaration, with no other code change.

---

## 10. Outcome measures

- ✅ R1 + R2 both gated (or R2 deleted).
- ✅ T2 cross-user regression test passes (User B cannot mutate User A's snapshot).
- ✅ T5 dead-route test passes (plural-snapshots route returns 404 with no handler running).
- ✅ Grep verification (T10): every `:snapshotId` route in `location.js` shows `requireSnapshotOwnership` on the declaration.
- ✅ `LESSONS_LEARNED.md` entry filed.
- ✅ `claude_memory` audit row filed and marked `resolved`.

---

## 11. References

- Audit finding (this session, 2026-05-07): two ungated `:snapshotId`-bearing routes in `server/api/location/location.js`.
- Canonical gate: `server/middleware/require-snapshot-ownership.js`
- Precedent for "delete dead duplicate over gate it": commit `b8a6b637` (`shared/identity.ts` deletion).
- Precedent for "no breadcrumb comments on deletion": `PLAN_remove-device-id-cross-user-fix-2026-05-06.md` §3.0.
- Sibling well-gated routers: `server/api/briefing/briefing.js`, `server/api/location/snapshot.js`.
