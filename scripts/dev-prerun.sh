#!/usr/bin/env bash
# scripts/dev-prerun.sh
# Workspace-only prerun invoked by .replit:run BEFORE node gateway-server.js.
# Deployment bypasses this entirely — .replit:[deployment].run does not call it.
# Two functions: F1 port-5000 cleanup, F2 client/dist verify.

set -e

# F1: Port-5000 zombie cleanup (Step A A7).
# Replit IDE re-runs can leave zombie processes bound to 5000; clear them
# before the new gateway binds. Silent if nothing is listening.
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:5000 | xargs -r kill -9 2>/dev/null || true
fi

# F2: client/dist verify + staleness rebuild.
# Without this, workspace shows "cannot get" on fresh checkout because the
# Express static handler has no index.html to serve. Deployment.build runs
# npm run build:client explicitly; workspace has no equivalent unless this
# script runs.
# 2026-08-11: also rebuild when ANY client source file is newer than the
# built bundle — the missing-only check meant a Run-button restart kept
# serving a stale bundle after client edits ("changes don't show without
# restarting" was really "…without rebuilding").
if [ ! -f "client/dist/index.html" ]; then
  echo "[dev-prerun] client/dist/index.html missing — running npm run build:client"
  npm run build:client
elif [ -n "$(find client/src client/index.html -newer client/dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "[dev-prerun] client source newer than dist bundle — rebuilding"
  npm run build:client
fi
