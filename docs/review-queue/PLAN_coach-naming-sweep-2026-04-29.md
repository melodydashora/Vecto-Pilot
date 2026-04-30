# PLAN — Coach Naming Sweep (Option 1: "Coach" everywhere)

**Date:** 2026-04-29
**Author:** Claude Opus 4.7 (1M context)
**Status:** DRAFT — awaiting Melody approval

---

## Objective

Standardize the assistant's user-visible name to **"Coach"** (single form, everywhere) across all client surfaces. Eliminate the inconsistency between "Coach" / "AI Coach" / "Rideshare Coach" that currently coexist.

Per Melody's clarification: "coach is fine, we just need it to be 1 as it is called something different across the codebase." → Option 1 (single short form) wins because the bottom-nav tab constraint already forced "Coach" there; this brings the rest of the surface into alignment.

## Files affected (user-visible strings — required)

| File | Line | Current | New |
|---|---|---|---|
| `client/src/components/InstructionsTab.tsx` | 65 | `{ label: 'AI Coach', desc: '...' }` | `{ label: 'Coach', desc: '...' }` |
| `client/src/components/RideshareCoach.tsx` | 316 | `<h3>Rideshare Coach</h3>` | `<h3>Coach</h3>` |
| `client/src/components/RideshareCoach.tsx` | 499 | `<h4>Hey! I'm Your Rideshare Coach</h4>` | `<h4>Hey! I'm Your Coach</h4>` |
| `client/src/pages/co-pilot/CoachPage.tsx` | 20 | `<h1>Rideshare Coach</h1>` | `<h1>Coach</h1>` |

**Already correct (no change):**
- `client/src/components/co-pilot/BottomTabNavigation.tsx:48` — `label: 'Coach'` ✓
- `client/src/components/RideshareCoach.tsx:341` — `title="View Coach's Notes About You"` ✓
- `client/src/components/RideshareCoach.tsx:383` — `<h3>Coach's Notes</h3>` ✓

## Files affected (code comments — optional consistency sweep)

| File | Lines | Action |
|---|---|---|
| `client/src/components/concierge/AskConcierge.tsx` | 198, 283 | Comment text "matching AI Coach style" / "matches AI Coach styling" → "matching Coach style" / "matches Coach styling" |
| `client/src/components/RideshareCoach.tsx` | 15, 96 | Comments "Added for AI Coach notes panel feature" / "Notes panel state for AI Coach memory feature" → drop "AI" |
| `client/src/components/RideshareCoach.tsx` (multiple) | 117, 135, 201, 203, 222, 224, 250, 252 | `[RideshareCoach]` log prefix → keep as-is (this is a component-name log tag, not user-visible naming; renaming to `[Coach]` would lose the connection to the file) |

Component file name `RideshareCoach.tsx` → unchanged. Renaming the component file is a wider refactor (imports throughout app) that's out of scope here. The user-visible string is what we're standardizing; the file/component name is internal.

## Approach

1. Targeted Edit calls per surface (no sed sweep — sed has historically caused overshoot regressions per pending.md F1)
2. Verify no unintended occurrences via grep:
   - `grep -rn "AI Coach" client/src/ --include="*.tsx" --include="*.ts"` should return only the comment instances (now updated)
   - `grep -rn "Rideshare Coach" client/src/ --include="*.tsx" --include="*.ts"` should return only doc-comments in hooks/utilities (which describe what the code does, not user-visible UI)
3. Visual smoke test: every screen verified

## Test plan (Melody to verify)

| # | Surface | Expected |
|---|---|---|
| 1 | Bottom nav | Tab labeled "Coach" |
| 2 | Coach page (`/co-pilot/coach`) | H1 says "Coach" |
| 3 | Instructions tab | Onboarding card title says "Coach" (not "AI Coach") |
| 4 | Coach panel header | "Coach" (not "Rideshare Coach") |
| 5 | Coach welcome message (first chat) | "Hey! I'm Your Coach" (not "...Your Rideshare Coach") |
| 6 | Notes panel | "Coach's Notes" (unchanged — already correct) |
| 7 | Notes button tooltip | "View Coach's Notes About You" (unchanged) |
| 8 | Search across client/src/ | No remaining "AI Coach" or "Rideshare Coach" in user-visible strings |

## Risks

- **Marketing/brand external surfaces** — if "Rideshare Coach" appears in landing pages, app store metadata, marketing copy, those are out of scope here (this plan is in-app naming only). External surfaces follow whatever brand identity Melody decides separately.
- **Doc references** — `docs/architecture/RIDESHARE_COACH.md` and other doc files reference "Rideshare Coach" as the component/system name. These are internal architecture docs, not user-facing. Unchanged.

## What this plan is NOT

- Not a rename of the `RideshareCoach.tsx` component file
- Not a brand-identity change (the product internally can still be branded "Rideshare Coach"; the in-app UI text just says "Coach")
- Not a doctrine change to CLAUDE.md or architecture docs

## Future sweep (if needed)

If consistency turns out to be insufficient at "Coach" alone (e.g., an investor demo where the app needs to identify itself as a rideshare-specific assistant), we can revisit Option 2 ("Rideshare Coach" everywhere) or Option 3 (canonical+contextual system) cleanly because the naming is centralized in a small number of strings.
