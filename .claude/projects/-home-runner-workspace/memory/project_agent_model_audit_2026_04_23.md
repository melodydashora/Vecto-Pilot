---
name: Agent model/effort audit completed 2026-04-23
description: full inventory of all subagent models is captured — Opus 4.7 + effort max coverage achieved via two durable memories; don't re-audit unless plugins change
type: project
---

On 2026-04-23, completed a full audit of every subagent source in this workspace and landed coverage for Melody's "Opus 4.7 with /effort max for all agents" requirement. Two durable memories emerged (`feedback_feature_dev_opus_override.md`, `user_melody_effort_max.md`) plus this index.

**Audit snapshot (valid until plugin versions change):**

| Source | Agents | Declared model | Effective in an Opus 4.7 session |
|---|---|---|---|
| `/home/runner/workspace/.claude/agents/` | docs-sync, frontend-ux-auditor, memory-keeper | `opus` | Opus 4.7 ✅ |
| plugin `code-simplifier` v1.0.0 | code-simplifier | `opus` | Opus 4.7 ✅ |
| plugin `pr-review-toolkit` (2 of 6) | code-reviewer, code-simplifier | `opus` | Opus 4.7 ✅ |
| plugin `pr-review-toolkit` (4 of 6) | comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer | `inherit` | Opus 4.7 ✅ |
| plugin `superpowers` v5.0.7 | code-reviewer | `inherit` | Opus 4.7 ✅ |
| plugin `feature-dev` v5a71459c0314 | code-architect, code-explorer, code-reviewer | **`sonnet`** | Sonnet unless per-invocation override applied ⚠️ |

**Why:** Melody's question "are all agents running Opus 4.7 with effort max" turned out to be mostly already-true, with one gap (feature-dev). Because plugin cache files are rewritten by `/reload-plugins`, config-layer fixes don't stick — behavior-layer overrides do. That's why the feature-dev fix lives in a feedback memory instructing per-invocation `model: "opus"` rather than a patch to the agent file.

**How to apply:**
- If anyone re-asks this question, point to this memory + the two linked ones and skip the audit. The verification command in `feedback_feature_dev_opus_override.md` re-runs the inventory in ~1 second if you want to confirm no plugin version shipped a change.
- Rebuild this snapshot only if: (a) a new plugin is installed, (b) `/reload-plugins` runs after a plugin update, (c) a project-level agent is added under `.claude/agents/`, or (d) Melody reports a subagent that feels off-model.
- Deliberately NOT modified: plugin cache files (would be clobbered), `.claude/settings.json` (no relevant knobs), CLAUDE.md (memory layer is the right home).

**Unverified assumption flagged in the linked memories:** session-level `/effort max` is believed to propagate to subagents but is not documented or introspectable. If a subagent output ever feels lower-effort, that's the assumption to revisit first.
