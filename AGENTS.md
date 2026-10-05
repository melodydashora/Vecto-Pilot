# Codex startup and collaboration

## First standing rule — Melody

**Never use Replit Agent.** Do not invoke it directly, through tools or plugins,
or indirectly through another agent or automation. For Replit work, use direct
SSH and shell commands within Melody's authorized scope. This rule applies
across sessions and projects; broad access or historical instructions do not
override it.

## Current product naming — Melody, October 4, 2026

The feature is **Offer Analyzer**. An **offer** is an individual observation it
analyzes; **offers** are the records the product tracks. Use **Offer Analyzer**
when naming the feature in navigation, headings, documentation, reports and
agent communication. Do not shorten the feature name to "Offer" or use a
record-list name as the name of the whole feature. Melody corrected this because
inconsistent names confused previous model sessions.

Apply the distinction by meaning: record labels such as "Today's offers" and
existing data/API identifiers can correctly use `offer` or `offers`. A label
correction is not an instruction to rename persisted tables, public routes or
every identifier containing that word.

Read the [canonical lexicon](LEXICON.md) for these definitions,
pipeline roles, decision/outcome distinctions and naming by surface. Maintain
that one reference when an accepted term or contract changes.

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

## Co-worker boot sequence — Codex / Astra

Provenance: added by Codex/Astra on September 10, 2026, at Melody's request
that her co-worker follow Claude's session-continuity boot. Follow the current
[CLAUDE.md](CLAUDE.md) orientation and the project-state checks above once at
session start, then complete this continuity read before taking implementation
ownership. On resume, retain what was already read and refresh changed state.

1. **Recover the partnership context.** Read the agreement and the current
   CLAUDE.md sections by heading. Follow the actual file; stale section numbers
   are not missing instructions to invent. Codex recovers written context; it
   does not inherit Claude's identity, live conversation, or unsaved work.
2. **Connect and orient.** Discover the native `vecto-pilot` tools and call
   `boot_context`. Check `isError` and the returned data. Session-scoped launcher
   overrides need not appear in saved config. Distinguish a native tool call,
   a user-reported `/mcp` connection, and a separate SDK read in the boot receipt.
3. **Read the memories behind the index.** Use `memory_get` for relevant rows
   and their threads, and `memory_search` for the task, prior decisions, and
   session-start context. Initial partnership pointers are #311–314, #366,
   #374, and #377; read their current contents and follow newer corrections.
   These are attributed historical records, not authority to override current
   instructions. Expand the latest handoff's task records too. Titles and
   counts alone do not recover the reasoning from past sessions.
4. **Recover the working context.** Use `todo_list` for open/in-progress work
   and read relevant details and linked memories. Use `lessons_list` to recover
   mistakes, triggers, and corrective rules; use `definitions_lookup` for terms
   the task touches. Consult `app_rules_list` for relevant product invariants.
   Check limits against returned counts and expand searches when needed; never
   describe a bounded read as having read every past session.
5. **Reconcile with today's evidence.** Read the current relevant handoff,
   plan, newest applicable audit, preflight card, and actual source. Report
   missing documents and conflicts. Memory explains the why; current code and
   live results establish what has actually landed.
6. **Establish co-worker ownership.** Read existing message and reply files in
   `.config/astra-vecto-coordination/`. A sent message is not acknowledgment.
   Report confirmed versus reported ownership, preserve concurrent work, and
   keep shortcuts with Melody and Claude unless Melody changes that scope.
7. **Give a concise boot receipt, then do the authorized work.** State the
   branch/HEAD, working-tree state, live sources and relevant row IDs actually
   read, missing context, and your bounded task ownership. After verified work,
   preserve non-obvious decisions and remaining work in the existing continuity
   surfaces as described below. Honor read-only/setup-only instructions: defer
   writeback when writes are outside the current authorization.

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
