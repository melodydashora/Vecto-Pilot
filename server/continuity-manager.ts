import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Simple lock mechanism for atomic operations
let bumpLock = false;

interface SelfContinuity {
  continuity_token: string;
  last_updated: string;
  bump_count: number;
  signature: string;
}

interface SelfRules {
  version: string;
  rules: string[];
  created_at: string;
}

const CONTINUITY_FILE = 'continuity.json';
const DATA_DIR = 'data';

// Generate signature for continuity data
function generateSignature(data: string): string {
  const selfSig = process.env.SELF_SIG;
  if (!selfSig) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ SELF_SIG environment variable not set, using development default');
      const devSecret = 'dev-continuity-secret-' + crypto.randomBytes(16).toString('hex');
      return crypto.createHmac('sha256', devSecret).update(data).digest('hex');
    }
    console.error('Error: SELF_SIG environment variable is missing.');
    throw new Error('Missing SELF_SIG environment variable required for self-continuity system in server/continuity-manager.ts');
  }
  return crypto.createHmac('sha256', selfSig).update(data).digest('hex');
}

// Verify signature
function verifySignature(data: string, signature: string): boolean {
  try {
    const expected = generateSignature(data);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

// Initialize or load continuity data
async function initializeContinuity(): Promise<SelfContinuity> {
  const continuityPath = path.join(DATA_DIR, CONTINUITY_FILE);
  
  try {
    const data = await fs.readFile(continuityPath, 'utf-8');
    const continuity: SelfContinuity = JSON.parse(data);
    
    // Verify integrity
    const dataToSign = JSON.stringify({
      continuity_token: continuity.continuity_token,
      last_updated: continuity.last_updated,
      bump_count: continuity.bump_count
    });
    
    if (!verifySignature(dataToSign, continuity.signature)) {
      throw new Error('Continuity integrity check failed');
    }
    
    return continuity;
  } catch {
    // Create new continuity data
    const newContinuity: SelfContinuity = {
      continuity_token: crypto.randomBytes(32).toString('hex'),
      last_updated: new Date().toISOString(),
      bump_count: 0,
      signature: ''
    };
    
    const dataToSign = JSON.stringify({
      continuity_token: newContinuity.continuity_token,
      last_updated: newContinuity.last_updated,
      bump_count: newContinuity.bump_count
    });
    
    newContinuity.signature = generateSignature(dataToSign);
    
    await fs.writeFile(continuityPath, JSON.stringify(newContinuity, null, 2));
    return newContinuity;
  }
}

// Save continuity data
async function saveContinuity(continuity: SelfContinuity): Promise<void> {
  const continuityPath = path.join(DATA_DIR, CONTINUITY_FILE);
  
  const dataToSign = JSON.stringify({
    continuity_token: continuity.continuity_token,
    last_updated: continuity.last_updated,
    bump_count: continuity.bump_count
  });
  
  continuity.signature = generateSignature(dataToSign);
  await fs.writeFile(continuityPath, JSON.stringify(continuity, null, 2));
}

// Get self rules
function getSelfRules(): SelfRules {
  return {
    version: "1.0.0",
    rules: [
      "Maintain continuity token integrity across restarts",
      "Validate bearer token authentication in production",
      "Ensure atomic operations for token increments",
      "Keep continuity.json out of version control",
      "Implement self-checks before server startup",
      "Mount data/self on durable storage in production",
      "Prevent tampering with signature validation",
      "Synchronize horizontally scaled instances"
    ],
    created_at: new Date().toISOString()
  };
}

// Main initialization function
export async function ensureSelfStore(): Promise<void> {
  console.log('🔧 Initializing self-continuity system...');
  
  try {
    await ensureDataDir();
    await initializeContinuity();
    console.log('✅ Self-continuity system initialized');
  } catch (error) {
    console.error('❌ Failed to initialize self-continuity system:', error);
    throw error;
  }
}

// Get current continuity state
export async function getContinuityState(): Promise<{ continuity: SelfContinuity; integrity: string }> {
  const continuity = await initializeContinuity();
  
  // Verify current integrity
  const dataToSign = JSON.stringify({
    continuity_token: continuity.continuity_token,
    last_updated: continuity.last_updated,
    bump_count: continuity.bump_count
  });
  
  const integrity = verifySignature(dataToSign, continuity.signature) ? 'ok' : 'corrupted';
  
  return { continuity, integrity };
}

// Bump continuity token with atomic lock
export async function bumpContinuity(): Promise<SelfContinuity> {
  // Wait for any ongoing bump operation to complete
  while (bumpLock) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  
  bumpLock = true;
  
  try {
    const continuity = await initializeContinuity();
    
    continuity.bump_count += 1;
    continuity.last_updated = new Date().toISOString();
    
    await saveContinuity(continuity);
    return continuity;
  } finally {
    bumpLock = false;
  }
}

// Get self rules
export function getRules(): SelfRules {
  return getSelfRules();
}