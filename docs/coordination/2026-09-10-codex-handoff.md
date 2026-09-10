# Codex in Replit: September 10 handoff

Provenance: Codex/Astra source inspection and handoff preparation, requested by
Melody on September 10, 2026. This is a dated record of work and authorization;
it is not a deployment certification or a new product specification.

## Melody's current task and authorization

Melody asked to enhance VectoPilot and described interest in monetizing it. She
then directed that Codex work inside Replit, alongside the existing Claude
workflow, and authorized putting the necessary startup/handoff setup in Git.
Commit and push of that setup are authorized for this task. This does not mark
application changes, a merge, or a production deployment as already performed.

Use the CLI for project work. Phone shortcuts remain with Melody and Claude;
do not replace shortcut links or take over that work as part of this handoff.
Safe reversible investigation and implementation within her requested scope
should proceed without routine permission requests. Preserve concurrent work.

## Verified source baseline

On September 10 the Windows source checkout was clean on
`codex/vectopilot-release-readiness-20260907`. The session's remote-ref check
matched these local source references:

| Reference | Commit | Meaning |
|---|---|---|
| `main` | `609e935b495f7381073218e7214b0d41cf3d6b7c` | Source baseline before MCP preservation |
| `codex/vectopilot-mcp-preserve-20260907` | `87a31c00245a76dc8e925f0152733551b82ef450` | Preserved MCP source and handoff; draft PR #55 |
| `codex/vectopilot-release-readiness-20260907` | `cb83f522521b8fa8d9b19f4acdab4350aaca77aa` | Documentation backlog stacked on the preservation branch; draft PR #56 |

An isolated worktree was prepared on `codex/vectopilot-signin-20260910`, starting
from `cb83f522...`. The task changed to Replit startup/handoff before this pass
implemented the proposed application fixes. Recheck the eventual published
setup branch and commit rather than inferring its identity from the worktree
name. PR numbers above identify the preservation records; their current status
must be checked before integration.

The active Replit checkout can differ from GitHub and the Windows checkout.
Before incorporating this setup, inspect its current branch, HEAD, status,
replacement refs, and any concurrent edits. September 7 records describe
preserved Replit history and recovery copies; do not reset or discard them to
make branches match. Transfer only the reviewed setup changes when histories or
working trees differ.

During setup, the coordinating Codex session reached the actual Replit Bash
shell and verified `/home/runner/workspace`, a clean `main` working tree reported
as one commit ahead of `origin/main`, Node 20.20, and npm 11.12.1. It checked only
that `DATABASE_URL` was available; its value was not printed. Codex was initially
absent; the official standalone installer then installed Codex CLI 0.154.0.
The live Replit HEAD was `6a97c058`. These shell observations establish workspace
access and installation, not a completed Codex login or a live continuity read.

Replit Agent reported creating the local coordination message
`.config/astra-vecto-coordination/2026-09-10-message.md`. Receipt or acknowledgment
by Claude was not verified. A file's existence is not proof that another running
session read it; verify acknowledgment before assuming overlapping work is
coordinated.

## What was inspected, and what is still open

The existing [release-readiness backlog](../plans/2026-09-07-release-readiness.md)
remains the working reference. September 7 recorded it under development todo
#75 and continuity #386; these are historical IDs, not a claim that this Windows
pass reread their current database contents.

Two candidate fixes were confirmed in source at the baseline above:

- **VP-002, Google callback completion:**
  `client/src/pages/auth/google/Callback.tsx` stores the exchanged token in
  localStorage and navigates, but never updates the mounted AuthProvider.
  AuthProvider restores from localStorage only on mount, so ProtectedRoute can
  still see a signed-out React state. The server already returns the full
  login-compatible token/user/profile/vehicle payload. A focused fix should use
  one successful-auth completion path for password and Google login, preserve
  the terms step, and verify entry into a protected route without reload.
- **VP-006, private cache cleanup:** `client/src/App.tsx` provides one
  QueryClient, while `auth-context.tsx` clears a different exported client.
  Offers use a query key without user identity. A focused fix should target the
  actual provided client, scope offers by user, and prevent stale requests from
  restoring the prior account. Location/CoPilot React state also needs a
  deliberate cleanup on account transitions; query-cache cleanup alone does
  not prove full isolation.

These findings are **inspected, not fixed** by the setup handoff. Re-read current
code before implementing them. The minimum useful regression evidence is
existing-user Google login, successful and failed terms completion, account A
logout then account B login in one application lifetime, and late responses
from A never appearing in B. The old Jest config selects JavaScript tests only;
a new TSX test must be wired into an actually executed harness.

VP-001/003/004/005 cover backend identity uniqueness, atomic creation, identity
linking, and OAuth state binding. They remain separate open work. This pass did
not test live sign-in, production data, billing, pricing, or monetization.

## Boot and continuity in the new session

Run `bash scripts/start-codex.sh` from the project root. The launcher starts a
new Codex session with the real standalone MCP server over stdio, forwards the
existing `DATABASE_URL` by name, and requests a first turn of startup verification
without application or database writes. It applies Melody's requested full
available permissions and does not force a model. Credentials remain outside Git.
For the last session use `bash scripts/start-codex.sh resume --last`.
If sign-in is needed, run `codex login --device-auth` and complete OpenAI's account
flow before launching. Installation and login are host-specific; this Git commit
does not transfer Desktop authentication or session history to Replit.

Read [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md), and the existing
[partnership agreement](../../AI_PARTNERSHIP_AGREEMENT.md). Read the real Replit
working state before using this dated summary to choose work.

Use the existing standalone MCP continuity tools when connected: `boot_context`
followed by relevant memory/task/lesson/definition reads. See
[the MCP implementation guide](../architecture/mcp-server.md) and
`server/mcp/continuity-tools.js`. `DATABASE_URL` remains the sole database
selector. Do not copy its value or any authentication material into this file.

The existing `node scripts/memory-cli.mjs help` describes the older `/agent/*`
memory CLI. Its `context` command prints summary information and does not
hydrate the modern continuity tables. Reuse it when that legacy surface is
relevant; do not treat successful summary output as proof of reading all shared
memory.

Live continuity was unavailable to the Windows inspection in this pass. Replit
shell access and availability of the injected database setting were subsequently
verified, but the connected MCP boot remains a next step. No new database read
or memory hydration is claimed here. The Replit Codex session is a separate
session that can recover written context, not the same live Desktop conversation.
Record which live tools/records it actually reads and continue useful independent
work if a particular connection is unavailable.

This public Git handoff contains source references and task context only. Keep
credentials, supplied test identities, private records, and chat transcripts in
their existing private locations. Record final setup verification and the
published commit in the task's delivery receipt rather than inventing those
results in advance.
