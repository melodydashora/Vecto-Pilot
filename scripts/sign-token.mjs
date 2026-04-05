#!/usr/bin/env node
/**
 * Sign a JWT with RS256 for testing RLS
 *
 * This creates a JWT token that can be used to authenticate
 * API requests with RLS enabled.
 * 
 * Usage:
 *   node scripts/sign-token.mjs [user_id] [tenant_id]
 * 
 * Examples:
 *   node scripts/sign-token.mjs user_123
 *   node scripts/sign-token.mjs user_456 tenant_acme
 */

import { readFileSync } from 'fs';
import { importPKCS8, SignJWT } from 'jose';

const userId = process.argv[2] || 'user_123';
const tenantId = process.argv[3] || null;

console.log('🔐 Signing JWT token...\n');

try {
  // Read private key
  const pkcs8 = readFileSync('keys/private.pem', 'utf8');
  const privateKey = await importPKCS8(pkcs8, 'RS256');
  
  // Build claims
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: userId,
    role: 'authenticated',
  };
  
  if (tenantId) {
    claims.tenant_id = tenantId;
  }
  
  // Sign JWT
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ 
      alg: 'RS256', 
      kid: 'vectopilot-rs256-k1' 
    })
    .setIssuer('https://vectopilot.app')
    .setAudience('vectopilot-api')
    .setIssuedAt(now)
    .setExpirationTime('24h')
    .sign(privateKey);
  
  console.log('✅ JWT signed successfully\n');
  console.log('📋 Claims:');
  console.log(`   User ID: ${userId}`);
  if (tenantId) console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Role: authenticated`);
  console.log(`   Issuer: https://vectopilot.app`);
  console.log(`   Audience: vectopilot-api`);
  console.log(`   Expires: 24 hours\n`);
  
  console.log('🎫 JWT Token:');
  console.log(jwt);
  console.log('\n📝 Usage:');
  console.log('   curl -H "Authorization: Bearer <token>" <your-api-url>');
  console.log('\n⚠️  Token expires in 24 hours. Generate a new one if expired.\n');
  
} catch (error) {
  console.error('❌ Error signing token:', error.message);
  process.exit(1);
}
