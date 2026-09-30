# Coach memo export runbook

Reviewed September 29, 2026 against [pull-coach-memos.mjs](../scripts/pull-coach-memos.mjs)
and the [canonical Coach trace](architecture/RIDESHARE_COACH.md).

The primary memo receipt is a confirmed `coach_memos` row. The chat route also
attempts a workspace inbox append. Its current DAL status policy creates deployment
rows as `new` and workspace rows as `exported`; failure of that workspace append
does not erase the DB row, but this `new`-row exporter will not discover it automatically.
Do not invent a save from a chat phrase or file append alone.

Use only the `DATABASE_URL` already supplied to the authorized environment. The
script does not infer a database from a deployment name, use an alternate URL,
start the application gateway or run migrations. `--dev` is rejected.

```bash
npm run pull-coach-memos -- --help
npm run pull-coach-memos -- --dry-run
npm run pull-coach-memos
```

The preview reports counts and leaves file and row state unchanged. Export acquires
a transaction-scoped advisory lock, selects `new` rows with row locks, appends each
memo plus an ID receipt to `docs/coach-inbox.md`, then marks selected rows exported.
Concurrent exporters using the same database serialize before selection. A completed
file receipt survives DB rollback, so retry after a status/commit failure skips the
already appended row. No successful receipt is deleted to recover a failed export.

Limitations: an incomplete OS file write can leave partial text without a completed
receipt; review that file before retrying. Existing old append entries without
receipts cannot be automatically deduplicated. Exporters against different databases
writing the same file do not share the database lock. Chat's best-effort append is
a separate writer; this script deliberately appends rather than overwriting the
inbox. The script does not make private memo content safe to commit—keep private
conversations and driver data out of Git.

A failure returns exit code 1 and retains completed receipts for recovery. Confirm
saved records through the authenticated Coach memo UI or an authorized read in the
same environment. The review used [mock DB/file tests](../tests/coach/memo-export.test.js);
no operator export against the supplied application database was executed.
