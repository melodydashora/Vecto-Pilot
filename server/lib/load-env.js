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
  
  // Webservice mode validation
  if (mode === 'webservice') {
    if (process.env.ENABLE_BACKGROUND_WORKER === 'true') {
      console.error('❌ ENV CONTRACT VIOLATION: ENABLE_BACKGROUND_WORKER=true in webservice mode');
      console.error('   Autoscale deployments cannot run background workers.');
      console.error('   Use DEPLOY_MODE=worker for background processing.');
      process.exit(1);
    }
    
    if (process.env.USE_LISTEN_MODE === 'true') {
      console.error('❌ ENV CONTRACT VIOLATION: USE_LISTEN_MODE=true in webservice mode');
      console.error('   Webservice mode should not use LISTEN mode.');
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
 * Load environment configuration based on DEPLOY_MODE
 * Priority: Replit Secrets > mode-specific.env > shared.env > mono-mode.env (fallback)
 */
export function loadEnvironment() {
  const deployMode = process.env.DEPLOY_MODE || null;
  
  console.log('[env-loader] ========================================');
  console.log('[env-loader] Environment Contract Loader');
  console.log('[env-loader] ========================================');

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

  // New contract-driven approach
  console.log(`[env-loader] DEPLOY_MODE=${deployMode}`);

  // Step 1: Load shared.env (common variables)
  const sharedPath = path.join(rootDir, 'env/shared.env');
  if (loadEnvFile(sharedPath)) {
    console.log('[env-loader] ✅ Loaded: env/shared.env');
  } else {
    console.error('[env-loader] ❌ FATAL: env/shared.env not found');
    process.exit(1);
  }

  // Step 2: Load mode-specific env file
  const modeFile = `env/${deployMode}.env`;
  const modePath = path.join(rootDir, modeFile);
  if (loadEnvFile(modePath)) {
    console.log(`[env-loader] ✅ Loaded: ${modeFile}`);
  } else {
    console.error(`[env-loader] ❌ FATAL: ${modeFile} not found`);
    console.error(`[env-loader]    Valid modes: webservice, worker`);
    process.exit(1);
  }

  // Step 3: Validate contract
  console.log('[env-loader] Validating environment contract...');
  validateEnvContract();
  console.log('[env-loader] ✅ Contract validation passed');
  console.log('[env-loader] ========================================');
}
