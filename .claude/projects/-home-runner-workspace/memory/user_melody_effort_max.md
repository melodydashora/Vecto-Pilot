---
name: Melody prefers /effort max and Opus 4.7 for all Claude Code sessions
description: house default is Opus 4.7 with /effort max — at session start, if effort isn't already max, suggest running /effort max before substantive work begins
type: user
---

Melody's standing preference for Claude Code sessions:

- **Model:** Opus 4.7 (1M context) — the provisioned Opus tier in this workspace.
- **Effort level:** max (`/effort max`). Believed to propagate to subagents spawned from the session, but this is not documented or introspectable — if subagent output ever feels lower-effort than expected, this assumption is the first thing to revisit.
- **Subagent model:** Opus 4.7 for every subagent she spawns, regardless of the plugin's declared default. See `feedback_feature_dev_opus_override.md` for the one plugin (feature-dev) that needs explicit per-invocation override.

**Why:** She's building this repo as a "how to code with AI" reference implementation (per Rule 9 in CLAUDE.md — "ALL FINDINGS ARE HIGH PRIORITY, zero tolerance for drift"). The quality bar is high and the work is architecturally dense; dropping to Sonnet or lower-effort reasoning risks silent degradation on tasks like schema audits, AI-pipeline work, and multi-layer refactors.

**How to apply:**
- `/effort` is session-scoped and there is no `defaultEffort` key in settings.json, so this can't be automated at the harness level. At session start, if you notice effort is not set to max (or if you can't tell), surface it to Melody with a one-line nudge: "Want me to note that effort is currently <level> — should I wait for `/effort max` before we start?" Don't block on it silently; just flag and proceed.
- When invoking subagents, prefer agents that declare `model: opus` or `model: inherit` in their frontmatter. For feature-dev agents, apply the per-invocation override (see linked feedback memory).
- Don't suggest using Sonnet or Haiku for cost reasons — the preference is explicit and consistent.

**Not applicable to:** one-shot diagnostic questions where the task is trivially lookup-style. Max effort is for the default working mode, not a mandate for every keystroke.
