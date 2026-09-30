---
name: Offer Analyzer mobile preview
description: Why automated screenshots of authenticated mobile pages can be blank and how to verify safely.
---

The default automated screenshot browser may be rejected by the application's bot filter on JavaScript/CSS requests; a blank image with 403 asset responses does not by itself mean the application failed to render.

**Why:** The private Offer Analyzer also requires an authenticated session, precise GPS, and a valid location snapshot before its page appears. A plain headless browser cannot pass those gates, and should not use a real driver's session or offers for visual testing.

**How to apply:** First validate the running workflow and asset HTTP behavior. For mobile visual checks without a real account, use a browser with isolated synthetic auth, GPS, snapshot, rules, and offer responses, serving built assets locally if the screenshot agent's user agent is filtered. Clearly label resulting screenshots as synthetic rather than actual driver data.

The local workflow manager has also rejected webview configuration with a TOML-editor parsing error, while the Run-button project workflow in `.replit` was not registered with the manager in this session. A background shell on the webview port responded through the development proxy but was later killed, so it is not a durable preview solution.

**Why:** A reachable development URL during one check does not guarantee the preview will remain running after a turn ends.

**How to apply:** Prefer a managed webview workflow for a persistent preview. If the workflow manager cannot configure or discover one, retain the existing test workflow and report the live-preview limitation clearly instead of claiming a temporary shell is durable.