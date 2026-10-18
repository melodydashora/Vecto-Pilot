#!/bin/bash
# SessionStart hook: install Node dependencies so `npm run lint` and the jest
# suites work in Claude Code cloud sessions. Synchronous on purpose —
# dependencies are guaranteed present before the session's first turn.
set -euo pipefail

# Local sessions manage their own node_modules; only run in cloud sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `npm install` rather than `npm ci`: idempotent, and it reuses node_modules
# from the cached container state instead of deleting and refetching it.
# The lockfile still pins versions (README's clean-checkout gate uses it).
npm install --include=dev --no-audit --no-fund

# The container's npm rewrites lockfile metadata written by other npm major
# versions (e.g. strips "libc" fields). That churn is not a dependency
# change; restore the lockfile so the session starts with a clean tree.
git checkout -- package-lock.json 2>/dev/null || true

echo "session-start hook: npm dependencies ready" >&2
