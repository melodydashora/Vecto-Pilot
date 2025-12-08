#!/usr/bin/env node
// verify-fix.js - Test Gate 2 (Just-In-Time block generation) fix
import crypto from 'crypto';
import fetch from 'node-fetch';

// Get the secret (same as in auth.js)
const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID || 'dev-secret-change-in-production';
const userId = '5b4f85db-eedd-40db-9a98-57ead2aadaed';
const snapshotId = '4482f47a-7bae-45ac-9ead-e1eb8e99fbf4';

// Generate valid JWT token
const signature = crypto.createHmac('sha256', secret).update(userId).digest('hex');
const token = `${userId}.${signature}`;

console.log(`\n[verify-fix] Generated token for user: ${userId.substring(0, 20)}...`);
console.log(`[verify-fix] Token: ${token.substring(0, 50)}...`);

// Make GET request to blocks-fast endpoint
const url = `http://localhost:5000/api/blocks-fast?snapshotId=${snapshotId}`;

console.log(`\n[verify-fix] Testing GET /api/blocks-fast with snapshot: ${snapshotId}\n`);

try {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  const status = response.status;
  const data = await response.json();

  console.log(`[verify-fix] Response Status: ${status}`);
  
  if (status === 200) {
    console.log(`[verify-fix] ✅ SUCCESS: Got blocks!`);
    console.log(`[verify-fix] Block Count: ${data.blocks ? data.blocks.length : 0}`);
    if (data.blocks && data.blocks.length > 0) {
      console.log(`[verify-fix] First Block: ${data.blocks[0].name}`);
      console.log(`[verify-fix] 🎯 GATE 2 FIX VERIFIED: Just-in-time generation triggered!`);
    }
  } else if (status === 202) {
    console.log(`[verify-fix] ⏳ Still generating (202): ${data.reason}`);
    console.log(`[verify-fix] Message: ${data.message}`);
  } else {
    console.log(`[verify-fix] ❌ Unexpected status: ${data.error}`);
    console.log(`[verify-fix] Detail: ${data.detail || 'N/A'}`);
  }
  
  console.log(`\n[verify-fix] Full Response:`, JSON.stringify(data, null, 2).substring(0, 500));
  
} catch (error) {
  console.error(`[verify-fix] ❌ Request failed:`, error.message);
  process.exit(1);
}
