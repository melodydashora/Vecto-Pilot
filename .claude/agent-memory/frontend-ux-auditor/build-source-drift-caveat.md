---
name: build-source-drift-caveat
description: Visual audits via Playwright must reconcile the bundled build against current source code, because client/dist can lag source by hours and produce false visual findings.
metadata:
  type: feedback
---

When auditing UI/visual conformance via Playwright screenshots against the dev server (port 5000), always check the timestamp of `client/dist/assets/index-*.js` vs the source file timestamps before drawing visual conclusions.

**Why:** the workspace startup path (`scripts/start-replit.js`) builds the client only when `client/dist/index.html` is missing — incremental source edits do NOT trigger a rebuild on subsequent server starts. As of 2026-05-16 the welcome page source had been re-skinned to brand colors at 00:00, but the deployed bundle dated 2026-05-15 21:49 still served the old PDF palette. A visual audit at that moment captured the OLD palette and looked like a re-skin failure when the source code was actually correct.

**How to apply:**
1. Run `stat -c '%y' <source_file> <dist_file>` to compare ages.
2. If dist predates source, the visual audit is stale. Either rebuild (`npm run build:client`) or limit findings to source-code review only and call out the staleness in the report.
3. To probe what's actually deployed, grep the bundle for hex values: `grep -oE "(<old_hex>|<new_hex>)" client/dist/assets/index-*.js | sort | uniq -c`.

Related: [[welcome-schema-source]].
