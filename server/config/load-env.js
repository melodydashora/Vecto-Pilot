// server/lib/load-env.js
// Environment contract loader with validation
// Loads mode-specific env files based on DEPLOY_MODE

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
 * Validate env contract: fail fast if incompatible flags detected
 */
function validateEnvContract() {
  const mode = process.env.DEPLOY_MODE || 'mono';
  const isAutoscale = process.env.CLOUD_RUN_AUTOSCALE === '1';
  
  // Autoscale-specific validation (only applies when CLOUD_RUN_AUTOSCALE=1)
  if (mode === 'webservice' && isAutoscale) {
    if (process.env.ENABLE_BACKGROUND_WORKER === 'true') {
      console.error('❌ ENV CONTRACT VIOLATION: ENABLE_BACKGROUND_WORKER=true in autoscale mode');
      console.error('   Cloud Run Autoscale deployments cannot run background workers.');
      console.error('   Use Reserved VM deployment or DEPLOY_MODE=worker for background processing.');
      process.exit(1);
    }
    
    if (process.env.USE_LISTEN_MODE === 'true') {
      console.error('❌ ENV CONTRACT VIOLATION: USE_LISTEN_MODE=true in autoscale mode');
      console.error('   Autoscale mode should not use LISTEN mode.');
      process.exit(1);
    }
  }

  // Worker mode validation
  if (mode === 'worker') {
    if (process.env.ENABLE_BACKGROUND_WORKER !== 'true') {
      console.error('❌ ENV CONTRACT VIOLATION: ENABLE_BACKGROUND_WORKER must be true in worker mode');
      process.exit(1);
    }
  }
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
    console.log('[env-loader] GOOGLE_APPLICATION_CREDENTIALS already set, skipping reconstruction');
    return;
  }

  // Check if individual service account fields exist (these are the mandatory ones)
  const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
  const hasRequired = requiredFields.every(field => !!process.env[field]);

  if (!hasRequired) {
    console.log('[env-loader] No individual GCP service account env vars found, skipping credential reconstruction');
    return;
  }

  console.log('[env-loader] 🔑 Reconstructing GCP service account credentials from individual env vars...');

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

  console.log(`[env-loader] ✅ GCP credentials written to ${credPath}`);
  console.log(`[env-loader]    project_id=${credentials.project_id}, client_email=${credentials.client_email}`);
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
    console.log(`[env-loader] ✅ Set GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT_ID} (from GOOGLE_CLOUD_PROJECT_ID)`);
  }
}

/**
 * Load environment configuration based on DEPLOY_MODE
 * Priority: Replit Secrets > mode-specific.env > shared.env > mono-mode.env (fallback)
 */
export function loadEnvironment() {
  // 2026-02-11: Reconstruct GCP credentials FIRST (before any env file loading)
  // This ensures Vertex AI and Gemini CLI can authenticate via service account
  reconstructGcpCredentials();
  ensureGoogleCloudProject();
  const isReplitDeployment = process.env.REPLIT_DEPLOYMENT === '1' || process.env.REPLIT_DEPLOYMENT === 'true';
  const deployMode = process.env.DEPLOY_MODE || null;
  if (!process.env.APP_MODE && (deployMode === 'mono' || deployMode === 'split')) {
    process.env.APP_MODE = deployMode;
  }
  
  console.log('[env-loader] ========================================');
  console.log('[env-loader] Environment Contract Loader');
  console.log('[env-loader] ========================================');

  // In Replit deployment, skip file loading and use only process.env from Replit Secrets
  if (isReplitDeployment) {
    console.log('[env-loader] ✅ Replit deployment detected - using Replit Secrets (skipping .env files)');
    console.log('[env-loader] DEPLOY_MODE=' + (deployMode || 'mono'));
    console.log('[env-loader] Validating environment contract...');
    validateEnvContract();
    console.log('[env-loader] ✅ Contract validation passed');
    console.log('[env-loader] ========================================');
    return;
  }

  if (!deployMode) {
    // Fallback to mono-mode.env for backward compatibility
    console.log('[env-loader] No DEPLOY_MODE set, loading mono-mode.env (legacy)');
    const monoPath = path.join(rootDir, 'mono-mode.env');
    if (loadEnvFile(monoPath)) {
      console.log('[env-loader] ✅ Loaded: mono-mode.env');
    } else {
      console.warn('[env-loader] ⚠️  mono-mode.env not found');
    }
    return;
  }

  // New contract-driven approach (development only)
  console.log(`[env-loader] DEPLOY_MODE=${deployMode}`);

  // Step 1: Load shared.env (common variables - loaded FIRST as baseline)
  const sharedPath = path.join(rootDir, 'env/shared.env');
  if (loadEnvFile(sharedPath)) {
    console.log('[env-loader] ✅ Loaded: env/shared.env (baseline)');
  } else {
    console.warn('[env-loader] ⚠️  env/shared.env not found');
  }

  // Step 2: Load mode-specific env file (OVERRIDES shared values)
  const modeFile = `env/${deployMode}.env`;
  const modePath = path.join(rootDir, modeFile);
  
  if (fs.existsSync(modePath)) {
    // Force mode-specific values to override shared.env
    // Delete conflicting keys before loading mode-specific file
    const modeSpecificOverrides = ['PG_MAX', 'PG_MIN', 'PG_IDLE_TIMEOUT_MS', 'PG_CONNECTION_TIMEOUT_MS'];
    const modeContent = fs.readFileSync(modePath, 'utf-8');
    modeSpecificOverrides.forEach(key => {
      if (modeContent.includes(`${key}=`)) {
        delete process.env[key]; // Clear so mode-specific value can override
      }
    });
    
    if (loadEnvFile(modePath)) {
      console.log(`[env-loader] ✅ Loaded: ${modeFile} (overrides shared.env)`);
    } else {
      console.warn(`[env-loader] ⚠️  ${modeFile} could not be loaded`);
    }
  } else {
    console.warn(`[env-loader] ⚠️  ${modeFile} not found`);
  }

  // Step 3: Validate contract
  console.log('[env-loader] Validating environment contract...');
  validateEnvContract();
  console.log('[env-loader] ✅ Contract validation passed');
  console.log('[env-loader] ========================================');
}
