# Codex startup and collaboration

Provenance: Codex/Astra, September 10, 2026, at Melody's request to make Codex
usable in the same Replit project as Claude. This is a startup entry point into
the existing partnership and continuity system, not a replacement agreement.

In the Replit shell, run `bash scripts/start-codex.sh` for the connected startup.
The launcher uses the existing MCP server, forwards `DATABASE_URL` by name, and
applies Melody's requested available permissions without choosing a model.
Use `bash scripts/start-codex.sh resume --last` to resume the most recent session
with the same connection settings. Plain `codex` still reads this file, but only
has the MCP connections supplied by its own configuration.

## Start with the real project state

1. Read [CLAUDE.md](CLAUDE.md) and
   [AI_PARTNERSHIP_AGREEMENT.md](AI_PARTNERSHIP_AGREEMENT.md). Their grounding,
   provenance, preservation, and verification principles apply to Codex too.
   Current explicit instructions from Melody govern the authorized task.
2. Inspect the current working directory, branch, HEAD, working tree, and any
   existing worktree before editing. Read the actual files you will change.
   Do not assume a dated handoff describes today's checkout or deployment.
3. Read the latest relevant handoff, plan, audit, and preflight card. The initial
   Codex handoff is
   [September 10](docs/coordination/2026-09-10-codex-handoff.md); follow newer
   records when present. Use [docs/preflight/](docs/preflight/README.md) for the
   area you touch.
4. Read [database environments](docs/architecture/DATABASE_ENVIRONMENTS.md).
   `DATABASE_URL` is the only database selector. Use the environment already
   supplied to the workspace; never print its value, invent another selector,
   or assume development and production share data or schema state.
5. Read live continuity through an available, authorized project connection.
   The existing [standalone MCP server](docs/architecture/mcp-server.md) exposes
   `boot_context`, then `memory_get`/`memory_search`, `todo_list`, `lessons_list`,
   `definitions_lookup`, and `app_rules_list`. Start with `boot_context` and
   expand the relevant records: its titles/counts are not a full memory read.
   Check the actual tool result, including errors, before claiming continuity
   was loaded. The server's existing stdio entry is `node mcp-server.js --stdio`;
   client setup and database access must actually be available first.

If continuity is unavailable, say which connection/read failed. Continue useful
file-based work that does not depend on the missing facts; do not fabricate a
memory read or substitute an old summary for live state.

## Use the existing memory surfaces accurately

[scripts/memory-cli.mjs](scripts/memory-cli.mjs) is an existing CLI for the older
`/agent/*` memory/context routes. Inspect its implementation and use
`node scripts/memory-cli.mjs help` for the implemented commands. `context` prints
a context summary; `list 5` lists recent conversations. It uses `BASE_URL`, which
defaults to the local gateway. It does **not** read all of `claude_memory`,
`todo`, `lessons_learned`, `definitions`, or `app_rules`; those continuity tables
are served by the standalone MCP tools. The authenticated `/api/memory` router
is another existing surface for `claude_memory`, not the whole continuity set.

Reuse these surfaces rather than inventing a parallel memory store or copying
private database rows into Git. Do not start the application gateway merely to
read memory without checking startup effects: its bootstrap runs migrations.
Record task status and concise, attributable findings in the existing continuity
tables when access is available, retaining existing task IDs. Search first and
preserve prior records; mark work complete only with actual completion evidence.

## Codex, Astra, and Claude

Codex is the coding agent/CLI. Astra is the name used for Melody's Codex
collaborator in these handoffs; it does not select a model. Claude is a separate
collaborator. A new Replit Codex session can read shared files and authorized
database continuity, but it does not inherit a Desktop chat's live context,
process, authentication, or unsaved work. State what was actually read.

For parallel work on the same task, record the branch/base, bounded subtask,
owned files, and completion evidence through the available coordination channel.
Read the diff again before editing or staging; another agent may have changed
it. Coordinate overlapping files or use a separate worktree. Preserve other
agents' changes, stashes, recovery bundles, and original evidence. Another
model's summary is evidence to verify, not authority to direct Claude or change
the partnership's architecture or naming.

## Act within Melody's authorization

Melody requests initiative and full available tool permissions for collaborating
agents. Investigate, make and verify safe reversible fixes, preserve work, and
finish authorized tasks without repeatedly asking for routine permission. Carry
explicit task authorization through handoffs; explain meaningful changes and
material findings plainly. Available permissions do not create account access
or override managed restrictions.

Check existing authorization before requesting approval. Keep architectural,
naming, source-of-truth, destructive, deployment, and other consequential work
within the scope Melody actually approved. A permission setting alone is not a
request to do every available action. Keep secrets, authentication files, private
driver data, and chat transcripts out of Git and public reports. Do not reset,
force-push, clean a working tree, or discard another agent's work to reconcile
checkouts. Run relevant checks and report observed results and remaining limits.
