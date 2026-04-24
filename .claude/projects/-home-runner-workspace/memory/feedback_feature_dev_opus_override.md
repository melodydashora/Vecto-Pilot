---
name: feature-dev agents — pass model:"opus" on every invocation
description: feature-dev plugin agents (code-architect, code-explorer, code-reviewer) are hardcoded to sonnet — override with model:"opus" on every Agent call to keep them on Opus 4.7
type: feedback
---

When invoking any `feature-dev:*` subagent via the Agent tool (`feature-dev:code-architect`, `feature-dev:code-explorer`, `feature-dev:code-reviewer`), always pass `model: "opus"` as an explicit argument. The Agent tool's `model` parameter takes precedence over the agent definition's frontmatter.

**Why:** Melody wants every subagent she spawns to run on Opus 4.7 with max effort (the same tier as her main session). The feature-dev plugin ships those three agents hardcoded to `model: sonnet` in `~/.claude/plugins/cache/claude-plugins-official/feature-dev/5a71459c0314/agents/*.md`. Editing the cache is futile because `/reload-plugins` overwrites it; disabling the whole plugin would lose access to the agents entirely; shadowing via project-level `.claude/agents/` is unreliable for plugin-namespaced invocations. Per-invocation override is the only durable, non-destructive fix.

**How to apply:** Every Agent tool call of the form `Agent(subagent_type: "feature-dev:<name>", ...)` must include `model: "opus"`. Example:

```
Agent({
  subagent_type: "feature-dev:code-architect",
  model: "opus",
  description: "...",
  prompt: "..."
})
```

Does NOT apply to other agents — the project agents (`docs-sync`, `frontend-ux-auditor`, `memory-keeper`) are already `model: opus` in frontmatter, and the `pr-review-toolkit` / `code-simplifier` / `superpowers:code-reviewer` plugin agents are either `opus` or `inherit`. Only the three feature-dev agents need the explicit override.

**Verification command** (if you ever doubt the current state):
```bash
for f in $(find ~/.claude/plugins/cache -name "*.md" -path "*/agents/*"); do
  m=$(awk '/^---$/{f++;next} f==1' "$f" | grep -E "^model:" | head -1)
  echo "$f → $m"
done
```
If `feature-dev` agents are still `sonnet`, the override is still needed.

**Known caveat — skill-internal dispatch:** this override only covers subagent calls *you (Claude Code) make directly* via the Agent tool. If Melody invokes a skill like `/feature-dev` that internally dispatches `feature-dev:code-architect` etc. as part of its own flow, the skill's dispatcher won't know to pass `model: "opus"` and the sonnet default wins. The only fixes for that path are (a) disable the feature-dev plugin entirely or (b) a change by the skill's authors. Mention this to Melody if she leans heavily on the feature-dev skill.
