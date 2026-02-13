#!/usr/bin/env bash
# =============================================================================
# Vecto Pilot - Unified Startup Script
# =============================================================================
# This is the canonical entry point for starting the application.
# 
# USAGE:
#   ./start.sh              # Start in production mode
#   ./start.sh dev          # Start in development mode
#   ./start.sh clean        # Clean ports and start fresh
#
# WHAT IT DOES:
#   1. Loads environment variables from mono-mode.env and .env
#   2. Optionally clears port 5000 if conflicts exist
#   3. Starts the gateway server (which spawns SDK/Agent as needed)
#   4. Optionally starts the background worker for strategy generation
#
# PRODUCTION vs DEVELOPMENT:
#   - Production: Uses npm run start:replit (builds client first)
#   - Development: Uses node gateway-server.js directly (assumes client built)
#
# =============================================================================

set -euo pipefail

MODE="${1:-prod}"
PORT="${PORT:-5000}"
HOST="${HOST:-0.0.0.0}"

echo "[start] 🚀 Vecto Pilot Startup"
echo "[start] Mode: $MODE"
echo "[start] PORT: $PORT, HOST: $HOST"

# Load environment files
if [ -f .env_override ]; then
  set -a && source .env_override && set +a
  echo "[start] ✅ Loaded .env_override"
fi

if [ -f mono-mode.env ]; then
  set -a && source mono-mode.env && set +a
  echo "[start] ✅ Loaded mono-mode.env"
fi

if [ -f .env ]; then
  set -a && source .env && set +a
  echo "[start] ✅ Loaded .env"
fi

# ── GCP Credential Reconstruction (2026-02-11) ──
# Replit Secrets store service account fields individually.
# Google SDKs and the Gemini CLI need a single JSON file via GOOGLE_APPLICATION_CREDENTIALS.
if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ -n "${private_key:-}" ] && [ -n "${client_email:-}" ]; then
  echo "[start] 🔑 Reconstructing GCP service account credentials..."
  node -e '
    const fs = require("fs");
    let pk = process.env.private_key || "";
    if (pk && !pk.includes("\n")) pk = pk.replace(/\\n/g, "\n");
    const creds = {
      type: process.env.type || "service_account",
      project_id: process.env.project_id || "",
      private_key_id: process.env.private_key_id || "",
      private_key: pk,
      client_email: process.env.client_email || "",
      client_id: process.env.client_id || "",
      auth_uri: process.env.auth_uri || "https://accounts.google.com/o/oauth2/auth",
      token_uri: process.env.token_uri || "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: process.env.auth_provider_x509_cert_url || "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.client_x509_cert_url || "",
      universe_domain: process.env.universe_domain || "googleapis.com"
    };
    fs.writeFileSync("/tmp/gcp-credentials.json", JSON.stringify(creds, null, 2), { mode: 0o600 });
  ' && {
    export GOOGLE_APPLICATION_CREDENTIALS="/tmp/gcp-credentials.json"
    echo "[start] ✅ GCP credentials → $GOOGLE_APPLICATION_CREDENTIALS"
  }
fi

# Set GOOGLE_CLOUD_PROJECT from GOOGLE_CLOUD_PROJECT_ID if needed (2026-02-11)
if [ -z "${GOOGLE_CLOUD_PROJECT:-}" ] && [ -n "${GOOGLE_CLOUD_PROJECT_ID:-}" ]; then
  export GOOGLE_CLOUD_PROJECT="$GOOGLE_CLOUD_PROJECT_ID"
  echo "[start] ✅ Set GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT (from GOOGLE_CLOUD_PROJECT_ID)"
fi

# Clean mode: kill processes on target port
if [ "$MODE" = "clean" ]; then
  echo "[start] 🧹 Cleaning port $PORT..."
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:$PORT | xargs -r kill -9 2>/dev/null || true
    echo "[start] ✅ Port cleared"
  fi
fi

# Start the application
if [ "$MODE" = "dev" ] || [ "$MODE" = "clean" ]; then
  echo "[start] 🌐 Starting in development mode..."
  export NODE_ENV=development
  exec node gateway-server.js
else
  echo "[start] 🌐 Starting in production mode (with client build)..."
  export NODE_ENV=production
  exec npm run start:replit
fi