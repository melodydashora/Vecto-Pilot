#!/usr/bin/env node
/**
 * Generate JWKS (JSON Web Key Set) from RSA public key
 * 
 * This creates a public JWKS file at public/.well-known/jwks.json
 * that Neon (and other services) can use to verify JWTs.
 * 
 * Usage:
 *   node scripts/make-jwks.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { importSPKI, exportJWK } from 'jose';

const kid = 'vectopilot-rs256-k1';  // Stable key ID
const alg = 'RS256';

console.log('🔑 Generating JWKS from public key...\n');

try {
  // Read existing PEM files
  const spki = readFileSync('keys/public.pem', 'utf8');
  
  // Convert to JWK
  const publicKey = await importSPKI(spki, alg);
  const jwkPub = await exportJWK(publicKey);
  
  // Add required JWKS fields
  jwkPub.kid = kid;
  jwkPub.alg = alg;
  jwkPub.use = 'sig';
  
  // Ensure public/.well-known directory exists
  mkdirSync('public/.well-known', { recursive: true });
  
  // Write JWKS file
  const jwks = { keys: [jwkPub] };
  writeFileSync('public/.well-known/jwks.json', JSON.stringify(jwks, null, 2));
  
  console.log('✅ JWKS written to public/.well-known/jwks.json');
  console.log(`   Kid: ${kid}`);
  console.log(`   Algorithm: ${alg}`);
  console.log(`   Key Type: ${jwkPub.kty}`);
  console.log('\n📋 JWKS Preview:');
  console.log(JSON.stringify(jwks, null, 2));
  console.log('\n🌐 Serve this file at: https://<your-domain>/.well-known/jwks.json');
  console.log('🔐 Register this URL in Neon Console → Settings → RLS / Auth providers');
  
} catch (error) {
  console.error('❌ Error generating JWKS:', error.message);
  process.exit(1);
}
