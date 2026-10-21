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

# `npm ci`, not `npm install`: this is an unattended install path in a
# container holding repo credentials, so it must install exactly the
# integrity-pinned lockfile tree and fail loudly on lockfile drift instead
# of re-resolving semver ranges (README's clean-checkout gate uses the same
# command). npm ci never modifies package-lock.json, so the tree stays clean.
npm ci --include=dev --no-audit --no-fund

echo "session-start hook: npm dependencies ready" >&2
