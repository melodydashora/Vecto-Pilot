# Removals log — the comment & code change-management convention

**Origin:** Melody, 2026-08-11 (dictated): *"take out the annotations… save them
somewhere with today's date on them for any functions or features that you're
taking out and give it a little bit of reasoning so that we're staying all on the
same page… we're not keeping any more of those comments that are no longer needed
in our code. We need it to be clean and crisp."*

Enforced by `app_rules` row `comment-hygiene`.

## The rule

When you **remove** code, a feature, or a code comment — or a comment has gone
**stale** (describes behavior that no longer exists, names models/ids that have
rotated, excuses a gap that's since been fixed):

1. **Take it out of the code.** Clean and crisp wins; git blame is not a reason
   to keep dead prose inline.
2. **Preserve it here** in a dated sweep file: `YYYY-MM-DD-<topic>.md`, one file
   per sweep/session, numbered entries.
3. Each entry records: **file/function**, the **removed text** (verbatim, or
   abridged with a pointer to git history for long blocks), and a short
   **Reason** — why it left, and what replaced it if anything.

## What counts as a stale comment (remove on sight when touching a file)

- "Single-user / for now / temporary" notes whose condition has lapsed
- Model names, versions, prices, or dates that have rotated (see
  `app_rules: verify-models-live`)
- TODOs that were done (or superseded by a todo-table row — link the row instead)
- Narration of *what the next line does* or *where code came from* (review
  chatter, session references, "moved from X")
- Audit/finding labels (H-3, F-6, P0-4…) whose source doc no longer decodes them
  — restate the actual reasoning inline or remove

## What a comment SHOULD be (keep these)

A constraint the code can't show: a doctrine pointer (`app_rules`), a
non-obvious tradeoff, a "do NOT do X because Y" with the Y stated, a live
verification date for an external dependency.

## Cadence

Touch-a-file → clean that file's stale comments in the same change, logged in
that session's sweep file. No big-bang rewrites; the sweep rides along with real
work so it never blocks shipping. (Rolling sweep tracked in the todo table.)
