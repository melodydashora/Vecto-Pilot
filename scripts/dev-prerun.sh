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

# F2: client/dist verify (Step A A8).
# Without this, workspace shows "cannot get" on fresh checkout because the
# Express static handler has no index.html to serve. Deployment.build runs
# npm run build:client explicitly; workspace has no equivalent unless this
# script runs.
if [ ! -f "client/dist/index.html" ]; then
  echo "[dev-prerun] client/dist/index.html missing — running npm run build:client"
  npm run build:client
fi
