# Session: 2026-09-07 - MCP preservation and release review

Provenance: Codex (Astra Desktop) verification note for Melody and Claude. This is review input and a record of observed state, not an instruction to replace concurrent work. Melody explicitly requested that the stranded work be pushed.

## Preserved source

- Repository: `melodydashora/Vecto-Pilot` (public when verified).
- Draft PR: https://github.com/melodydashora/Vecto-Pilot/pull/55
- Branch: `codex/vectopilot-mcp-preserve-20260907`.
- Source commit: `51144f23aba1920acc0f799c92b9e21df80082d2`.
- Base: `609e935b495f7381073218e7214b0d41cf3d6b7c`.
- All 21 application, test, configuration-example and documentation files match their blobs in the original Replit snapshot `6a97c0584cc868fe8e2c7610c79f44a1b53ed1db`.
- The original snapshot also contains a local conversation transcript. That transcript remains in the original Replit commit and private local bundle; it is absent from the public preservation branch's history.
- Replit's push failed with `unable to get password from user`. A verified Git bundle was transferred to a separate bare repository on Windows and pushed using the existing Windows Git credential setup. GitHub's remote ref was then checked against the exact source commit.

No working-tree reset, branch switch in either active checkout, deployment, database migration or application rewrite was performed for preservation.

## Validation

The actual Replit command was:

```sh
NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js tests/mcp --runInBand
```

Result: **29 tests passed across 3 suites**, using the fake/in-memory store. These tests did not exercise the production database or paid model APIs. `git diff --check` passed. A credential-pattern scan of the 21 source blobs found no matching secrets; this is not a comprehensive security audit.

Source-only bundle: `vecto-source-preservation.bundle`, 40,759 bytes.

SHA-256: `bbd5b5ce47e135bc2bb03524a5ec469ca307c6ce05483f5380c13c243bf2cb09`.

## Windows comparison and locations

The current clone is `C:\Users\melod\OneDrive\Documents\GitHub\VectoPilot` (no hyphen in the folder name). The old Desktop Vecto-Pilot directory is a document/archive collection.

At comparison time, every one of the Windows clone's 19 modified/untracked MCP source files matched the preservation commit using Git-normalized blob hashes. The two remaining preserved files, `.env.local.example` and `package-lock.json`, were still at the base version in Windows. There were no additional Windows changes absent from the preserved source at that check. Concurrent work may subsequently change this state.

Replit artifacts are under `.config/astra-vecto-review-20260907/`: test log, preservation receipt, RESULT.md, source-only bundle and original-workspace-snapshot.bundle. They are local ignored artifacts.

Windows reports, source bundle and bare transfer repository are under `C:\Users\melod\.codex\vectopilot-review-20260907`. The user-facing inbox is `C:\Astra-Claude-Inbox`.

## Bounded release review findings

The source review inspected base commit `609e935b...`. These are source-confirmed contracts with inferred runtime consequences; controlled browser reproduction remains pending.

1. **Account-switch cache cleanup:** `client/src/App.tsx` constructs/provides one QueryClient, while `client/src/contexts/auth-context.tsx` clears another exported by `client/src/lib/queryClient.ts`. Offer queries use a key without user identity and a 30-second stale time. A previous driver's offers can remain in the active cache after logout. A useful regression is two mocked accounts in one SPA lifetime, asserting the first account's offers never appear while the second account loads.
2. **Lost earnings updates:** `OffersCard.tsx` posts cached earnings when changing a decision; `server/api/offer-analyzer/index.js` fully overwrites outcome fields without an expected version. Two tabs can load $10, one save $25, then the other post stale $10 during a decision change. Partial updates and/or explicit version conflicts merit focused review, preserving intentional clearing for Rejected/Cancelled.
3. **New-driver setup:** `SetupCard.tsx` still shows the older Analyze 2 iPhone shortcut and manual repairs, with no Android setup choice in that component. The roadmap reports Android text-lane success; this is an onboarding gap, not evidence that Android/backend functionality never worked. Replacement shortcut links require verification.
4. **Release checks:** the default E2E spec expects protected co-pilot content without an authentication fixture; some checks allow absent elements. Jest selects JavaScript tests while tracked TS/TSX tests are outside that suite. Replit Verify uses `tsc --noEmit` against the empty root project; the package's `npm run typecheck` uses `tsc -b` to check referenced projects.

The detailed local report is `ASTRA-RELEASE-CODE-REVIEW.md` in the Windows report directory. The live deployment, authenticated browser flows, real-device setup, production configuration, database continuity tables and full application build/typecheck were **not verified in this preservation pass**. The 29 MCP tests do not establish whole-app release readiness.

## Inbox collaboration-helper review

The duo-cli proposal in the inbox was inspected without executing it. Its sample GIF uses disclosed stub CLIs. As written, the helper selects Codex workspace-write (reintroducing the Replit sandbox failure), calls bare CLIs, kills an existing tmux session named duo, can ignore failures, and proposes new auth-state folders missing from its gitignore. Its review stage receives agent summaries rather than a collected diff. The detailed local report is `INBOX-DUO-REVIEW.md`.

Evidence_App's permission launchers were verified separately. This VectoPilot review did not configure VectoPilot's CLI permissions or install the helper.

## Pending work

The source is pushed and available in draft PR #55; integration into main and deployment remain pending. The focused release review above is available for the next implementation session. Current code and database continuity should be rechecked before changes, especially while Claude is working concurrently.
