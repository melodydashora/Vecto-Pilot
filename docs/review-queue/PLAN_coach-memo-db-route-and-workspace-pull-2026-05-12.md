# PLAN: Route COACH_MEMO writes to DB + workspace-side pull-and-commit script

**Date:** 2026-05-12
**Author:** Claude (Opus 4.7) + Melody
**Status:** PENDING APPROVAL (Rule 1 — awaiting Melody's "All tests passed" before implementation lands)
**Scope:** New DB table `coach_memos`, modified write path in `chat.js`, new workspace script `scripts/pull-coach-memos.mjs`, new npm script, new migration. Modest doc updates (CLAUDE.md Rule 12 line, RIDESHARE_COACH.md write surface table).
**Why this exists:** The current `[COACH_MEMO]` pipeline writes to `docs/coach-inbox.md` directly via `fs.appendFile` in `server/api/chat/chat.js:488-517`. In production (Cloud Run), the container filesystem is ephemeral — every memo Melody triggers during real driving is written to a phantom file that disappears on the next deploy. The repo's `docs/coach-inbox.md` (which Claude Code reads per Rule 12 priority 6) has not received a new entry since 2026-05-05 despite ~7 days of active prod use. Today's audit (this PR's parent conversation) confirmed three independent failure modes; this plan addresses the primary one — survivability — by routing writes to the Neon prod DB (which persists across deploys) and exporting on demand from the workspace.

---

## 1. Architectural decisions (already made by Melody)

| Decision | Choice | Rationale |
|---|---|---|
| Where do writes land in prod? | New `coach_memos` table in Neon (and Helium for dev) | DB survives Cloud Run redeploys; consistent with `coach_system_notes` precedent |
| How does the file get refreshed? | Workspace pull command, manual trigger | Aligns with Rule 18 operator-only-script precedent (`scripts/p3-13-prod-recheck.mjs` reads `PROD_DATABASE_URL`); avoids git-push-from-prod-container security/state risks |
| Keep current filesystem write? | YES — in addition, not instead of (dev workspace benefits) | In dev, the file write to repo working tree IS visible immediately; deleting that path would degrade dev UX. The fs.appendFile call stays, but its failure is no longer fatal because the DB row is the source of truth. |

## 2. Why these specific decisions (audit-trail summary)

- **Pass F audit** (`docs/architecture/audits/pass-f-issue-logging-survivability.md`, 2026-04-17) already established `coach_system_notes` lands in DB and `docs/coach-inbox.md` does not survive in prod.
- **Coach prompt** (`chat.js:1136-1143`) explicitly teaches `[COACH_MEMO]` for "feature_request, remember, bug, code_suggestion, observation, todo" with triggers including "remember this," "we should add," "don't forget."
- **Existing schema precedent** — `coach_system_notes` already uses a `status` state machine (`new → reviewed → implemented`). `coach_memos` should mirror that pattern for consistency.

---

## 3. Schema (new table `coach_memos`)

Created via Drizzle ORM (`shared/schema.js`) + raw SQL migration. Mirrors the validated `COACH_MEMO` payload exactly so the chat handler's write is a near-1:1 mapping.

```js
// shared/schema.js — append after coachSystemNotes definition
export const coachMemos = pgTable('coach_memos', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),               // feature_request | remember | bug | code_suggestion | observation | todo
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  priority: text('priority').notNull().default('medium'),  // high | medium | low
  related_files: jsonb('related_files'),       // string[]
  status: text('status').notNull().default('new'),  // new | exported | reviewed | implemented | rejected
  source: text('source').notNull().default('coach'),  // coach | system | manual
  exported_at: timestamp('exported_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Provenance — optional, useful for cross-referencing back to the original chat
  triggering_user_id: text('triggering_user_id'),
  triggering_conversation_id: uuid('triggering_conversation_id'),
  triggering_snapshot_id: uuid('triggering_snapshot_id'),
}, (table) => ({
  statusIdx: index('idx_coach_memos_status').on(table.status),
  createdAtIdx: index('idx_coach_memos_created_at').on(table.created_at.desc()),
}));
```

Migration file: `migrations/20260512_coach_memos.sql` — applied to dev (Helium) immediately; applied to prod (Neon) on next deploy.

**`status` lifecycle:**
- `new` — written by chat handler; pending export
- `exported` — pulled into `docs/coach-inbox.md` by the workspace script; Claude Code can see it
- `reviewed` — Claude Code has read and acknowledged the memo (manual flip when picking it up at session start)
- `implemented` — fix shipped (manual flip)
- `rejected` — won't implement (manual flip)

The workspace pull script flips `new → exported` after a successful file write + commit.

---

## 4. Changes by file

| File | Change | Lines (approx) |
|---|---|---|
| `shared/schema.js` | Add `coachMemos` table + index definitions | +20 |
| `migrations/20260512_coach_memos.sql` | NEW — CREATE TABLE + 2 indexes + trigger-managed `updated_at` | +30 |
| `server/lib/ai/rideshare-coach-dal.js` | Add `saveCoachMemo(memo, context)` method | +25 |
| `server/api/chat/chat.js` | Modify the `for (const memo of actions.coachMemos)` block (lines 488-517) — call DAL.saveCoachMemo FIRST, fs.appendFile becomes best-effort (dev-only convenience write) | -8 / +25 |
| `scripts/pull-coach-memos.mjs` | NEW — workspace operator script | +120 |
| `package.json` | Add `"pull-coach-memos": "node scripts/pull-coach-memos.mjs"` script | +1 |
| `CLAUDE.md` | Update Rule 12 priority 6 to note "polled by `npm run pull-coach-memos`"; update Rule 8 table to list `coach_memos` as a Coach write target | ~4 line edits |
| `docs/architecture/RIDESHARE_COACH.md` | Update the write-surface table at L111 — `COACH_MEMO` destination becomes "coach_memos table (+ docs/coach-inbox.md via export)" | 1 line |
| `docs/architecture/audits/pass-f-issue-logging-survivability.md` | Add a 2026-05-12 follow-up note: "Survivability gap addressed via coach_memos DB route; see PLAN_coach-memo-db-route-and-workspace-pull-2026-05-12.md and resulting commit." | +5 lines |

---

## 5. Detailed change — chat.js (current vs. proposed)

**Current** (`chat.js:488-517`):
```js
// 2026-02-17: Coach memos — write to docs/coach-inbox.md for Claude Code to pick up
const __dirname_chat = path.dirname(fileURLToPath(import.meta.url));
const coachInboxPath = path.join(__dirname_chat, '..', '..', '..', 'docs', 'coach-inbox.md');

for (const memo of actions.coachMemos) {
  try {
    const validation = validateAction('COACH_MEMO', {
      type: memo.type || 'observation',
      title: memo.title,
      detail: memo.detail,
      priority: memo.priority || 'medium',
      related_files: memo.related_files
    });
    if (!validation.ok) {
      results.errors.push(`CoachMemo validation: ${validation.errors.map(e => e.message).join(', ')}`);
      continue;
    }

    const { type, title, detail, priority, related_files } = validation.data;
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const filesLine = related_files?.length ? `\n  - Files: ${related_files.join(', ')}` : '';
    const entry = `\n### [${type.toUpperCase()}] ${title}\n- **Priority:** ${priority} | **Date:** ${timestamp}\n- ${detail}${filesLine}\n`;

    await appendFile(coachInboxPath, entry, 'utf-8');
    results.saved++;
    console.log(`[COACH] [ACTIONS] 📝 Coach memo saved to inbox: "${title}" (${type})`);
  } catch (e) {
    results.errors.push(`CoachMemo: ${e.message}`);
  }
}
```

**Proposed:**
```js
// 2026-05-12: Coach memos route to coach_memos DB table (survives Cloud Run redeploys).
// The docs/coach-inbox.md filesystem write is preserved as a best-effort dev convenience —
// in prod, that path is ephemeral and the write either fails or vanishes on next deploy.
// The DB row is the source of truth; workspace `npm run pull-coach-memos` materializes
// new rows into docs/coach-inbox.md for Claude Code to read per CLAUDE.md Rule 12.
const __dirname_chat = path.dirname(fileURLToPath(import.meta.url));
const coachInboxPath = path.join(__dirname_chat, '..', '..', '..', 'docs', 'coach-inbox.md');

for (const memo of actions.coachMemos) {
  try {
    const validation = validateAction('COACH_MEMO', {
      type: memo.type || 'observation',
      title: memo.title,
      detail: memo.detail,
      priority: memo.priority || 'medium',
      related_files: memo.related_files
    });
    if (!validation.ok) {
      results.errors.push(`CoachMemo validation: ${validation.errors.map(e => e.message).join(', ')}`);
      continue;
    }

    const { type, title, detail, priority, related_files } = validation.data;

    // PRIMARY WRITE: DB (survives Cloud Run). Throws on failure → propagates to results.errors.
    const dbRow = await rideshareCoachDAL.saveCoachMemo({
      type, title, detail, priority, related_files,
      triggering_user_id: req?.auth?.userId ?? null,
      triggering_conversation_id: conversationId ?? null,
      triggering_snapshot_id: snapshotId ?? null,
    });
    results.saved++;
    console.log(`[COACH] [ACTIONS] 📝 Coach memo saved to DB: "${title}" (${type}) id=${dbRow.id}`);

    // SECONDARY WRITE: filesystem (dev convenience). Best-effort — failure is logged, not raised.
    try {
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const filesLine = related_files?.length ? `\n  - Files: ${related_files.join(', ')}` : '';
      const entry = `\n### [${type.toUpperCase()}] ${title}\n- **Priority:** ${priority} | **Date:** ${timestamp}\n- ${detail}${filesLine}\n`;
      await appendFile(coachInboxPath, entry, 'utf-8');
    } catch (fsErr) {
      console.warn(`[COACH] [ACTIONS] FS write failed (non-fatal, DB row id=${dbRow.id}):`, fsErr.message);
    }
  } catch (e) {
    results.errors.push(`CoachMemo: ${e.message}`);
  }
}
```

**Key behavioral changes:**
1. DB write is mandatory; failure pushes to `results.errors`.
2. FS write is wrapped in its own try/catch and is non-fatal — the `dbRow.id` is logged so the operator can verify the DB row exists even if the FS write failed.
3. `results.saved++` only increments after successful DB write.

---

## 6. Workspace pull script (`scripts/pull-coach-memos.mjs`)

```js
#!/usr/bin/env node
// 2026-05-12: Operator script — reads PROD_DATABASE_URL (per Rule 18 documented exception),
// pulls coach_memos rows where status='new', appends them to docs/coach-inbox.md in the
// existing markdown format, then UPDATES the rows to status='exported', exported_at=NOW().
//
// Usage:
//   PROD_DATABASE_URL='...' npm run pull-coach-memos               # prod (default)
//   npm run pull-coach-memos -- --dev                              # pull from $DATABASE_URL instead
//   npm run pull-coach-memos -- --dry-run                          # show what would happen, write nothing
//
// Exit codes:
//   0 — success (0 or more rows exported)
//   1 — DB connection failure
//   2 — file write failure (DB rows NOT marked exported, safe to retry)
//   3 — DB status-update failure after file write (file has them, DB still says new — log + ask user)

import { Pool } from 'pg';
import { readFile, appendFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inboxPath = path.join(__dirname, '..', 'docs', 'coach-inbox.md');

const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const isDryRun = args.includes('--dry-run');
const connString = isDev ? process.env.DATABASE_URL : process.env.PROD_DATABASE_URL;
if (!connString) {
  console.error(isDev ? '✗ DATABASE_URL not set' : '✗ PROD_DATABASE_URL not set (use --dev to read workspace DB)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  ssl: isDev ? false : { rejectUnauthorized: false },  // Helium=no-SSL, Neon=SSL (see Rule 18)
});

try {
  const { rows } = await pool.query(`
    SELECT id, type, title, detail, priority, related_files, created_at, source
    FROM coach_memos
    WHERE status = 'new'
    ORDER BY created_at ASC
  `);

  if (rows.length === 0) {
    console.log(`✓ No new memos to export from ${isDev ? 'dev' : 'prod'} DB. Inbox is current.`);
    process.exit(0);
  }

  console.log(`Found ${rows.length} new memo(s) to export from ${isDev ? 'dev' : 'prod'} DB.`);

  // Build markdown payload matching the existing inbox format
  let payload = '';
  for (const row of rows) {
    const timestamp = new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ');
    const filesLine = (row.related_files && row.related_files.length)
      ? `\n  - Files: ${row.related_files.join(', ')}`
      : '';
    payload += `\n### [${row.type.toUpperCase()}] ${row.title}\n`;
    payload += `- **Priority:** ${row.priority} | **Date:** ${timestamp}\n`;
    payload += `- ${row.detail}${filesLine}\n`;
  }

  if (isDryRun) {
    console.log('--- DRY RUN — would append the following ---');
    console.log(payload);
    console.log('--- end dry run ---');
    process.exit(0);
  }

  // Write to file first; only mark DB rows exported after FS write succeeds
  try {
    await appendFile(inboxPath, payload, 'utf-8');
    console.log(`✓ Appended ${rows.length} memo(s) to ${inboxPath}`);
  } catch (fsErr) {
    console.error(`✗ Failed to write to ${inboxPath}: ${fsErr.message}`);
    console.error('  DB rows NOT marked exported — safe to retry.');
    process.exit(2);
  }

  try {
    const ids = rows.map(r => r.id);
    await pool.query(`UPDATE coach_memos SET status='exported', exported_at=NOW(), updated_at=NOW() WHERE id = ANY($1::uuid[])`, [ids]);
    console.log(`✓ Marked ${rows.length} DB row(s) as exported.`);
  } catch (dbErr) {
    console.error(`✗ FS write succeeded but DB status update failed: ${dbErr.message}`);
    console.error('  Memos are IN the file but still say status=new in DB.');
    console.error(`  Affected ids: ${rows.map(r => r.id).join(', ')}`);
    console.error('  Recommend manual flip: UPDATE coach_memos SET status=\\'exported\\', exported_at=NOW() WHERE id IN (...);');
    process.exit(3);
  }

  console.log('');
  console.log('Next step: review changes in docs/coach-inbox.md, then commit:');
  console.log('  git add docs/coach-inbox.md');
  console.log(`  git commit -m "docs(coach-inbox): pull ${rows.length} memo(s) from ${isDev ? 'dev' : 'prod'} DB ($(date -I))"`);
} finally {
  await pool.end();
}
```

**Why the script doesn't auto-commit:** Matches the rest of the repo's operator-script ethos — show the diff, let the human approve and commit. Auto-commit would conflict with the existing in-progress changes pattern.

---

## 7. Test cases (acceptance criteria)

Each test exercises the full path from a Coach response containing `[COACH_MEMO]` through to a workspace operator seeing the entry in `docs/coach-inbox.md`.

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | Coach emits valid `[COACH_MEMO]` in dev workspace | `coach_memos` row with `status='new'` AND new entry appended to `docs/coach-inbox.md` immediately (secondary FS write succeeds in dev) |
| 2 | Coach emits valid `[COACH_MEMO]` in prod (Cloud Run) | `coach_memos` row with `status='new'` in Neon DB. FS write either succeeds (logs `[COACH] [ACTIONS] 📝 Coach memo saved to DB`) and dies on next deploy, OR fails (logs `FS write failed (non-fatal, DB row id=…)`). Either way, DB row persists. |
| 3 | Coach emits malformed `[COACH_MEMO]` (missing title) | Validation fails; `results.errors` populated; NO DB row created. Existing behavior preserved. |
| 4 | DB unavailable during write | `results.errors` populated with the pg error; NO FS write attempted (current behavior: FS write would still fire). Acceptable tradeoff — single source of truth wins over partial writes. |
| 5 | Workspace operator runs `npm run pull-coach-memos -- --dry-run` against prod | Prints the markdown payload that would be appended; writes nothing; DB rows still `status='new'` |
| 6 | Workspace operator runs `npm run pull-coach-memos` against prod with 3 new rows | All 3 rows formatted + appended to `docs/coach-inbox.md`; all 3 marked `status='exported'`, `exported_at` populated. Console prints next-step git commands. |
| 7 | Workspace operator runs the pull script with `PROD_DATABASE_URL` unset | Exits with code 1 + clear error message ("set PROD_DATABASE_URL or pass --dev") |
| 8 | Workspace operator runs `npm run pull-coach-memos -- --dev` against dev DB with 1 row | Same as #6 but pulls from `$DATABASE_URL` (Helium). Useful for local validation of the round-trip. |
| 9 | Pull script run twice in a row, no new memos between | Second run prints "No new memos to export" and exits 0. Idempotent. |
| 10 | Claude Code session-start read of `docs/coach-inbox.md` after a successful pull | New entries visible at the bottom of the file, matching the existing format. Rule 12 priority 6 read works as before. |

**Manual verification** (after implementation lands):
1. Trigger a memo in dev by typing into Coach chat: "remember that the airport card needs a TSA wait time field" → confirm test #1.
2. Read `coach_memos` row from Helium: `psql "$DATABASE_URL" -c "SELECT id, type, title, status FROM coach_memos ORDER BY id DESC LIMIT 1;"`
3. Run `npm run pull-coach-memos -- --dev --dry-run` → confirm formatted output matches existing inbox style.
4. Run `npm run pull-coach-memos -- --dev` (no dry-run) → confirm file gets the new entry and DB row flips to `exported`.

---

## 8. Risk notes

- **Backward compatibility:** Existing entries in `docs/coach-inbox.md` are untouched. The new pipeline appends; it never rewrites. Old entries continue to be valid Rule 12 input.
- **Dev double-write:** In dev, the same memo lands in BOTH the DB AND the file synchronously. If the operator then runs `npm run pull-coach-memos -- --dev`, the same memo would be appended a SECOND time (because the FS write doesn't update `status='exported'`). **Mitigation:** in `chat.js`, on successful DB write, ALSO update the row to `status='exported', exported_at=NOW()` IF `process.env.REPLIT_DEPLOYMENT !== '1'` (i.e., workspace). That way dev memos are pre-marked exported and the pull script naturally skips them. Documented as a "dev-only flag" inline.
- **PROD_DATABASE_URL handling:** The operator must set this env var locally; it's NOT auto-injected. Per Rule 18, `DATABASE_URL` is the only auto-injected DB var. Document this clearly in the script's `--help` output and in CLAUDE.md Rule 12.
- **No SSE return-channel change:** The chat handler's return shape doesn't change. Existing clients that read `results.errors` and `results.saved` keep working.
- **Migration ordering:** Dev migration applies at session start (manual `psql -f migrations/20260512_coach_memos.sql`). Prod migration applies on next deploy via the existing `migrations/` runner. Until prod migration applies, prod COACH_MEMO writes will fail (DAL throws on missing table) — this is **acceptable for the deploy window** (~minutes) but flagged.
- **Validation schema unchanged:** `validate.js:153-160` (`rideshareCoachMemoSchema`) is untouched. Same shape, new destination.

---

## 9. Implementation order

1. **Write this plan doc** → (this commit, pending approval).
2. **Wait for Melody's "All tests passed" approval** (Rule 1).
3. **Migration first:** `migrations/20260512_coach_memos.sql` + `shared/schema.js` addition. Apply to dev Helium. Confirm `\d coach_memos` shape matches plan.
4. **DAL method:** Add `saveCoachMemo()` to `rideshare-coach-dal.js` with unit-level smoke test (insert + select).
5. **Chat handler:** Modify the loop in `chat.js:488-517` per §5. Test in dev by manually triggering a memo via Coach chat.
6. **Pull script:** Write `scripts/pull-coach-memos.mjs`. Test against dev with `--dev --dry-run`, then `--dev` (real write), then verify the file diff.
7. **Doc updates:** CLAUDE.md Rule 12 line + Rule 8 table entry; RIDESHARE_COACH.md write-surface table; pass-f audit follow-up note.
8. **Manual end-to-end verification:** tests #1, #5, #6, #8 from §7.
9. **Commit + push** (Melody to push, per session convention).
10. **Prod deploy** (Melody's Replit Publish flow).
11. **First prod pull:** ~24 hours after deploy, run `npm run pull-coach-memos` against PROD_DATABASE_URL, confirm the inbox file gets the bugs from your real driving.

---

## 10. Approval

- [ ] Melody reviewed and approved this plan
- [ ] All tests passed (per §7)
- [ ] Schema applied to dev Helium
- [ ] Implementation commit reference: _______________
- [ ] Prod deploy commit reference: _______________
- [ ] First successful prod pull date: _______________
