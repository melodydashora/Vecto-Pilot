# Session Handoff — 2026-04-16

**Architect:** Claude Opus 4.6 (with Melody's approval on all plans before execution)
**Duration:** Full session — concierge UI fix through accessibility P1 hardening
**Commits:** 5 (reverse-chronological below)

---

## What shipped

### ee7ae1e2 — Accessibility: WCAG 2.5.5 touch targets on base Button component
**For the driver:** Every button in the app is now 44px tall (up from 40px) — easier to tap while driving, fewer mistouches.
**Revert:** `git revert ee7ae1e2` (restores h-10 globally, independent of other commits)

### b05260c0 — Accessibility: bump BarsMainTab action buttons to 44px touch target
**For the driver:** Phone call, Navigate, Refresh, and Try Again buttons on the Bars tab are now 44px minimum — previously as small as 28px.
**Revert:** `git revert b05260c0` (only affects BarsMainTab.tsx)

### 0ccf89ae — Accessibility: reduced motion, skip link, ARIA semantics
**For the driver:** If your phone has "Reduce Motion" enabled (iOS) or "Remove animations" (Android), the app now respects it — no spinning, pulsing, or bouncing. Skip-to-content link added for keyboard/screen reader users. Bottom navigation is now a proper `<nav>` with screen reader labels.
**Revert:** `git revert 0ccf89ae` (4 files: index.css, CoPilotLayout.tsx, BottomTabNavigation.tsx, RideshareCoach.tsx)

### 8f5676f7 — Apply pending 4-column migration + persist doctrine synthesis
**For the driver:** Your profile can now store fuel economy, daily earnings goal, shift hours target, and max deadhead distance. These feed into the venue scoring engine (values default to 25mpg/15mi until you set them — SettingsPage UI is next).
**Revert:** Columns are additive (`ADD COLUMN IF NOT EXISTS`) — safe to leave. Doctrine synthesis is doc-only.

### 7670a63b — Driver preference scoring + venue data integrity fixes
**For the driver:** Venue recommendations now consider your home base and deadhead tolerance. Venues beyond your comfort zone are flagged `beyond_deadhead` (not hidden — you still get 6 venues, always). Bars tab no longer shows venues with unconfirmed hours as "open." Venue coordinates now come from Google Places (verified), not from the AI guessing.
**Revert:** `git revert 7670a63b` (largest commit — touches tactical-planner.js, venue-intelligence.js, venue-cache.js, consolidator.js, plus concierge UI fixes and 3 new doc files)

---

## What she should test on her drive

- **Buttons feel bigger.** Every button across the app (especially Bars tab phone/navigate, Coach send, strategy refresh) is now 44px tall. Tap them — they should feel noticeably easier to hit than before.
- **Reduce Motion works.** Go to iOS Settings > Accessibility > Motion > Reduce Motion (ON). Reopen the app. Loading spinners, pulsing dots, and slide-in animations should all stop. Turn it back off and they return.
- **Bars tab: no ghost venues.** The Bars tab should only show venues with confirmed Google hours. If a venue previously appeared with no hours listed, it should now be gone. Confirmed-open venues and closed-but-high-value staging venues still appear.
- **Coach chat still streams.** Open the Rideshare Coach, send a message. Streaming should work exactly as before — the ARIA changes are invisible to sighted users.
- **Concierge chips wrap correctly.** Open the public concierge page (scan your QR code or visit `/c/{token}`). The 4 suggested question chips ("What's nearby?", "Best places to eat", "Events happening now", "Things to do here") should display in a centered wrapped layout, no horizontal scrollbar.

---

## What's next

From `docs/architecture/DOCTRINE_SYNTHESIS.md` — 7 recommended actions:

| # | Action | State |
|---|--------|-------|
| 1 | Run the 4-column pending migration | **DONE** (dev applied 2026-04-16, prod pending your approval) |
| 2 | Delete or gut `perplexity-api.js` | Pending |
| 3 | Add decisions #15-17 to DECISIONS.md (Hours Trust, Always-6, Prefs-as-Tiebreaker) | **SHOULD-DO-SOON** |
| 4 | Rename CONSTRAINTS.md to ENV_VARS.md | Pending |
| 5 | Add "SUPERSEDED" banner to AI_RIDESHARE_COACH.md | Pending |
| 6 | Expand API_REFERENCE.md or delete it | Pending |
| 7 | Build `max_deadhead_mi` slider in SettingsPage | **NEXT** |

### After the SettingsPage slider

The next highest-impact work is **stale-while-revalidate for the briefing pipeline**. Right now, when a driver opens the app or moves to a new location, they see a blank briefing screen for 60-90 seconds while 6 data sources generate in parallel. Returning users who drove 2 miles don't need a full regeneration — they need to see their last briefing immediately with a "refreshing..." indicator, then swap in new data when it arrives. This is the #1 UX friction point for daily users and was flagged in BRIEFING.md's own "wasted API calls" self-critique (lines 343-370). The pattern is well-understood (HTTP stale-while-revalidate, React Query's `placeholderData`), the briefing data is already cached in the DB, and the change is server-read + client-display only — no new API calls, no schema changes, no AI pipeline modifications.

---

## Known gaps not addressed this session

- **Accessibility P2:** `aria-live="polite"` on chat is done (Batch 5), but map marker labels and shape differentiation still pending (ACCESSIBILITY.md lines 244-245)
- **Accessibility P3:** 200% zoom testing and full third-party WCAG 2.1 AA audit not started (ACCESSIBILITY.md lines 248-249)
- **DEPRECATED.md contradiction:** `server/lib/external/perplexity-api.js` (624 lines) still exists despite being listed as "REMOVED" in DEPRECATED.md line 26 — needs investigation and deletion
- **API_REFERENCE.md stale:** 28 lines covering <30% of endpoints — conflicts with BRIEFING.md (15 endpoints), CONCIERGE.md (11 endpoints), AUTH.md (9 endpoints)
- **No row-level security at DB layer:** User data isolation is enforced in API code only (`WHERE user_id = req.auth.userId`), not via PostgreSQL RLS policies (DB_SCHEMA.md line 313)
- **Color-only indicators:** BarsMainTab open/closed dot, MapTab venue grade markers, and MarketDeadheadCalculator zone dots all use color as the sole differentiator — WCAG 1.4.1 violation for colorblind users
- **Future scaling:** `snapshots` and `coach_conversations` tables will need time-based partitioning eventually (DB_SCHEMA.md line 311)

---

## Memory entries this session

| ID | Category | Title |
|----|----------|-------|
| 132 | architecture-fix | Driver preference scoring added to tactical planner |
| 133 | operational-decision | Committed driver-preference scoring with max_deadhead_mi still in pending migration batch |
| 134 | migration | 4-column driver preference migration applied to dev DB |
| 135 | accessibility-fix | WCAG 2.1 AA P1 accessibility fixes: reduced motion, skip link, ARIA, touch targets |

---

## Safety notes for Melody

- **Prod migration NOT yet applied.** The 4 `driver_profiles` columns (`fuel_economy_mpg`, `earnings_goal_daily`, `shift_hours_target`, `max_deadhead_mi`) exist in dev only. Code is backward-compatible via the PG `42703` fallback — prod still works with 15mi default deadhead. Run the migration on prod at your operational discretion.
- **Client bundle is current.** `npm run build:client` was run after each accessibility batch. The live dev preview already reflects the new touch targets and reduced-motion CSS.
- **Server is unchanged** from before the accessibility work. No server restart needed to pick up the UI changes — `express.static` serves the new bundle from disk.
