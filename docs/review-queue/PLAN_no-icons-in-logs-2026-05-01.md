# PLAN — Remove icons / emojis from logs and codebase text

> **Date:** 2026-05-01
> **Status:** AWAITING APPROVAL — no code changes until Melody confirms tier-by-tier
> **Author:** Claude Code (Opus 4.7)
> **Doctrine:** Rule 1 (plan before implement), Rule 16 (Melody is architect)
> **Spec source:** Melody's directive 2026-05-01: *"I don't like icons, `<>` or `*****` anywhere, especially in logs"*

---

## 1. Objective

Remove visual markers (Unicode icons, emojis, asterisk-bracketed placeholders, angle-bracketed placeholders) from logs and codebase text per Melody's stated preference. Replace with plain English where signal is needed; remove entirely where the icon was decorative.

Square brackets (`[CONFIG]`, `[ENV]`, `[BOOT]`, `[MISSING]`) remain allowed — they're standard log-section convention and not in the exclude list.

## 2. Scope categorization

The 125 initial console.* hits expand to ~235 distinct surfaces when you include AI prompt builders and tests. Three tiers with different risk profiles.

| Tier | Surface | Hit count | Risk | Action |
|---|---|---|---|---|
| **A** | `console.log`/`error`/`warn`/`info`/`debug` in `server/`, `scripts/`, `shared/` | 125 | **Low** — pure observability change, no functional impact | Strip icons; preserve text labels |
| **B** | AI prompt builders (`prompt += '...✓...'` patterns) — primarily `server/lib/ai/coach-dal.js`, briefing-service, possibly others | 40 | **Medium** — changing prompt text changes what's sent to Claude/Gemini/GPT; model behavior may shift | Decision required (see §5) |
| **C** | Test files (`tests/**`) | 70 | **Medium** — test assertions that grep stdout for icons would fail if logs are stripped; test fixtures with icons may match patterns the code no longer emits | Audit + update assertions and fixtures |

## 3. Tier A — Logs (recommended: do now)

### 3.1 Concrete examples

```javascript
// Before
console.log(`✅ Strategy generated for ${snapshotId}`);
console.error(`❌ Failed to fetch events: ${err.message}`);
console.warn(`⚠️ Cache miss for ${key}`);

// After
console.log(`Strategy generated for ${snapshotId}`);
console.error(`Failed to fetch events: ${err.message}`);
console.warn(`Cache miss for ${key}`);
```

### 3.2 What survives

- `[BRACKET]` log-section prefixes — already convention
- Plain English status words: `OK`, `FAIL`, `MISSING`, `set`, `not set`
- Numbers, identifiers, paths, error messages — all unchanged

### 3.3 What's stripped

- Checkmarks: `✓` `✅`
- X-marks: `✗` `❌`
- Circles: `○`
- Warnings: `⚠️` `⚠`
- Action emojis: `🚀` `🎯` `🔥` `🎉` `✨` `💥` `🏢` `🤖` `📍` `📅` `🌐` `📝` `📊` `🛑`
- Hourglass / clock: `⏳` `⌛`
- Locks: `🔐` `🔑`

### 3.4 Test cases

- T-A1: `node --check` passes on every modified file
- T-A2: Tree-wide grep `grep -rn -E "console\.(log|error|warn|info|debug).*[✓✗○❌✅⚠⏳🚀🔥📝📊🎉🤖🏢🛑✨💥🎯📍📅🌐🔐🔑]" server/ scripts/ shared/` returns zero hits
- T-A3: Gateway boots cleanly, structured log output is unchanged in shape (just plain text instead of icons)
- T-A4: Spot-check 5 representative log lines after a snapshot/strategy run; confirm semantics preserved

## 4. Tier B — AI prompt builders (DECISION REQUIRED)

### 4.1 Where they are

Largest concentration in `server/lib/ai/coach-dal.js` lines 1179-1188:
```javascript
prompt += `\n   ✓ Driver Profile: ${...}`;
prompt += `\n   ✓ Vehicle: ${...}`;
prompt += `\n   ✓ Snapshot: ...`;
// ... 7 more ✓ lines for the data-availability summary
```

These build the "DATA ACCESS SUMMARY" block in the Coach prompt. The `✓` is a semantic marker telling the model "this data is present."

Likely other locations: briefing-service.js, event-verifier.js, holiday-detector.js, possibly venue-related scorers — any module that builds prompt strings programmatically.

### 4.2 Why this is a real decision, not a stylistic strip

Changing prompt text → changes what goes to the model → can shift model behavior. The Coach has been running with `✓ X: present` formatting for months; the model has likely adapted to that format. Stripping the `✓` and going to plain text (`X: present`) is semantically equivalent to a human reader, but to a transformer model it's a different token sequence.

In practice, modern LLMs are robust to this kind of text variation. But "robust" ≠ "identical" — there can be subtle shifts in response style or emphasis.

### 4.3 Three options

- **(a) Strip icons from prompts too.** Apply the directive uniformly. Risk: subtle model-behavior shift in Coach responses. *Need to smoke-test Coach behavior post-change.*
- **(b) Leave icons in prompts.** They're not "in logs" per the original directive; keep them as model-facing tokens. Logs (Tier A) still get cleaned. Risk: codebase inconsistency.
- **(c) Replace icons with semantic plain words.** `✓ X: present` → `[present] X: ...` or `X: present (data loaded)`. Most disruptive textually, lowest model-shift risk because the *meaning* of the marker is preserved.

**My recommendation:** option (a) — strip them. LLMs handle plain text fine; the data-availability semantics are still encoded in the words `Complete`, `Ready`, `Pending`, etc. that remain. But this is your call.

### 4.4 Test cases for Tier B

- T-B1: Smoke-test Coach tab — open with a populated snapshot, ask a question, verify the Coach response is still relevant and contextual (not vague or confused)
- T-B2: Compare Coach output before/after for the same input snapshot; expect minor wording variation but no semantic regression
- T-B3: `node --check` passes on coach-dal.js and any other prompt-builder files

## 5. Tier C — Test files

### 5.1 Likely failure modes

- Test assertions that match log output: `expect(stdout).toContain('✓ Strategy generated')`
- Test fixtures with icons that the code no longer emits
- Snapshot tests of console output

### 5.2 Approach

- Identify all 70 test-file hits via grep
- For each: determine if it's an *assertion* (must update if Tier A is applied) or just a *test data string* (no impact)
- Update assertions to match plain-text output post-strip
- Re-run `npm run test:unit` to confirm nothing breaks

### 5.3 Sequencing relative to A and B

Tier C should follow Tier A — strip from production code first, then update tests to match the new output. If we did it the other way around, tests would pass artificially against unmodified code.

## 6. Recommended execution sequence

1. **Tier A (logs)** — bulk surgical strip across server/, scripts/, shared/. Plan-doc-reviewable. ~125 small edits.
2. **Tier C (tests)** — update assertions to match new log output. ~70 lines, mostly mechanical.
3. **Smoke-test the gateway + test suite end-to-end.** All T-A* and T-C* pass.
4. **Tier B (prompts)** — pending Melody's decision on a/b/c.

## 7. PR shape

This work should be a **separate PR off main** (not bundled into `chore/drop-consolidated-strategy-2026-05-01`):

- New branch: `chore/no-icons-in-logs-2026-05-01` (matches naming pattern)
- Commits per tier, atomic-by-purpose:
  - `refactor(logging): strip Unicode icons from console.* statements (Tier A)`
  - `test: update assertions to match plain-text log output (Tier C)`
  - `refactor(prompts): strip icons from AI prompt builders (Tier B)` *(if approved)*
- PR description references this plan doc
- Merges after current `chore/drop-consolidated-strategy-2026-05-01` lands in main

## 8. Open questions for Melody

1. **Approve Tier A as-is** for next session?
2. **Tier B option:** (a) strip, (b) leave, (c) replace with semantic plain words?
3. **Are emojis in code comments / commit messages / docs in scope** too, or is this strictly logs + prompts? (Some files have explanatory comments with emojis; those are dev-facing, not log output.)
4. **Are the `[MISSING]` and other square-bracketed log markers I added definitely OK**, or do you want those flattened too?

---

**No code changes from this plan.** Sweep implementation starts only after your tier-by-tier approval.
