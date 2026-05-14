// server/config/load-env.js
// Environment loader: GCP credential reconstruction + .env.local loading
// 2026-02-25: Simplified — removed DEPLOY_MODE contract, renamed mono-mode.env → .env.local

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '../..');

/**
 * Parse .env file into process.env
 * @param {string} filePath - Path to .env file
 * @returns {boolean} - True if file was loaded
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') {
      continue;
    }

    // Parse KEY=VALUE or KEY=${VAR}
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2];

      // Handle ${VAR} substitution (for Replit Secrets)
      value = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, varName) => {
        return process.env[varName] || '';
      });

      // Only set if not already in environment (Replit Secrets take precedence)
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  return true;
}

/**
 * Reconstruct Google Cloud service account credentials from individual env vars.
 * Replit Secrets store each field separately — the Google SDK needs a single JSON file.
 *
 * Only runs if:
 *   - GOOGLE_APPLICATION_CREDENTIALS is not already set
 *   - The critical individual env vars exist (type, project_id, private_key, client_email)
 *
 * 2026-02-11: Added for Vertex AI / Google Cloud authentication
 */
function reconstructGcpCredentials() {
  // Skip if already configured
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('[CONFIG] [ENV] GOOGLE_APPLICATION_CREDENTIALS already set, skipping reconstruction');
    return;
  }

  // Check if individual service account fields exist (these are the mandatory ones)
  const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
  const hasRequired = requiredFields.every(field => !!process.env[field]);

  if (!hasRequired) {
    console.log('[CONFIG] [ENV] No individual GCP service account env vars found, skipping credential reconstruction');
    return;
  }

  console.log('[CONFIG] [ENV] Reconstructing GCP service account credentials from individual env vars...');

  // Handle private_key: Replit Secrets may store \n as literal two-char sequence
  let privateKey = process.env.private_key || '';
  if (privateKey && !privateKey.includes('\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const credentials = {
    type: process.env.type,
    project_id: process.env.project_id,
    private_key_id: process.env.private_key_id || '',
    private_key: privateKey,
    client_email: process.env.client_email,
    client_id: process.env.client_id || '',
    auth_uri: process.env.auth_uri || 'https://accounts.google.com/o/oauth2/auth',
    token_uri: process.env.token_uri || 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: process.env.auth_provider_x509_cert_url || 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.client_x509_cert_url || '',
    universe_domain: process.env.universe_domain || 'googleapis.com'
  };

  const credPath = '/tmp/gcp-credentials.json';
  fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;

  console.log(`[CONFIG] [ENV] GCP credentials written to ${credPath}`);
  console.log(`[CONFIG] [ENV]    project_id=set, client_email=set`);
}

/**
 * Ensure GOOGLE_CLOUD_PROJECT is set from GOOGLE_CLOUD_PROJECT_ID if needed.
 * The Google Cloud SDK expects GOOGLE_CLOUD_PROJECT, but Replit Secrets may use
 * GOOGLE_CLOUD_PROJECT_ID instead.
 *
 * 2026-02-11: Added for Vertex AI compatibility
 */
function ensureGoogleCloudProject() {
  if (!process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT_ID) {
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT_ID;
    console.log(`[CONFIG] [ENV] Set GOOGLE_CLOUD_PROJECT=set (from GOOGLE_CLOUD_PROJECT_ID)`);
  }
}

/**
 * Resolve APP_RUNTIME — the sanctioned environment-class enum.
 *
 * Resolution precedence (per Manifesto §3b, see env-registry.js doctrine comment):
 *   1. Explicit APP_RUNTIME env var (highest) — set by .replit:run or test runner
 *   2. Derived from REPLIT_DEPLOYMENT in ['1', 'true'] → 'deployment'
 *   3. Default: 'workspace' (local dev outside Replit)
 *
 * 2026-05-13: Added during Phase 2 v2 startup unification (step 2 of the Manifesto
 * Appendix). Idempotent — safe to call multiple times.
 */
export function resolveAppRuntime() {
  const explicit = process.env.APP_RUNTIME;
  if (explicit && ['workspace', 'deployment', 'test'].includes(explicit)) {
    return explicit;
  }
  if (['1', 'true'].includes(process.env.REPLIT_DEPLOYMENT)) {
    return 'deployment';
  }
  return 'workspace';
}

/**
 * Load environment configuration.
 *
 * Two paths:
 *   1. Replit deployment (REPLIT_DEPLOYMENT=1) → use Replit Secrets only, skip file loading
 *   2. Dev/workspace → load .env.local as baseline (Replit Secrets still take precedence)
 *
 * GCP credentials are reconstructed first in both paths.
 * 2026-05-13: APP_RUNTIME side-effect added to both paths so downstream consumers
 * (validate-env.js, gateway-server.js bootstrap, future feature code) can read
 * process.env.APP_RUNTIME directly in any environment.
 */
export function loadEnvironment() {
  // 2026-02-11: Reconstruct GCP credentials FIRST (before any env file loading)
  // This ensures Vertex AI and Gemini CLI can authenticate via service account
  reconstructGcpCredentials();
  ensureGoogleCloudProject();

  const isReplitDeployment = process.env.REPLIT_DEPLOYMENT === '1' || process.env.REPLIT_DEPLOYMENT === 'true';

  console.log('[CONFIG] [ENV] ========================================');
  console.log('[CONFIG] [ENV] Environment Loader');
  console.log('[CONFIG] [ENV] ========================================');

  // In Replit deployment, skip file loading — Replit Secrets are the sole source of truth
  if (isReplitDeployment) {
    console.log('[CONFIG] [ENV] Replit deployment detected - using Replit Secrets (skipping .env files)');
    console.log('[CONFIG] [ENV] ========================================');
    // 2026-05-13: Resolve APP_RUNTIME (Phase 2 v2 §3) before returning so deployment
    // callers have process.env.APP_RUNTIME set when they reach validate-env.js.
    if (!process.env.APP_RUNTIME) {
      process.env.APP_RUNTIME = resolveAppRuntime();
      console.log(`[CONFIG] [ENV] APP_RUNTIME resolved: ${process.env.APP_RUNTIME}`);
    }
    return;
  }

  // 2026-02-25: Dev/workspace: load .env.local as baseline
  // Renamed from mono-mode.env to align with .replit shell source and industry convention
  const envLocalPath = path.join(rootDir, '.env.local');
  if (loadEnvFile(envLocalPath)) {
    console.log('[CONFIG] [ENV] Loaded: .env.local');
  } else {
    console.warn('[CONFIG] [ENV] .env.local not found (dev baseline)');
  }

  // 2026-05-13: Resolve APP_RUNTIME and persist into process.env if not already set.
  // Downstream consumers (validate-env.js, gateway-server.js bootstrap, feature code)
  // read process.env.APP_RUNTIME directly. resolveAppRuntime() is also exported for
  // callers that need the value before loadEnvironment() has run (e.g., test setup).
  if (!process.env.APP_RUNTIME) {
    process.env.APP_RUNTIME = resolveAppRuntime();
    console.log(`[CONFIG] [ENV] APP_RUNTIME resolved: ${process.env.APP_RUNTIME}`);
  }
}
