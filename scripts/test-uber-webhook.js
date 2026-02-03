#!/usr/bin/env node
// scripts/test-uber-webhook.js
// 2026-02-03: Test script to simulate Uber webhook with proper HMAC signature
//
// Usage: node scripts/test-uber-webhook.js [url]
// Default URL: http://localhost:5000/api/auth/uber/webhook

import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.UBER_WEBHOOK_SECRET || 'ad1d0f6f5d1a73565aff6f17500b290bc1d832ce94d7fb342fffc687fea4eca7';
const TARGET_URL = process.argv[2] || 'http://localhost:5000/api/auth/uber/webhook';

// Sample webhook payload (simulating trip completed event)
const payload = {
  event_type: 'trips.completed',
  event_id: `test-${Date.now()}`,
  event_time: new Date().toISOString(),
  resource_href: 'https://api.uber.com/v1/trips/test-trip-123',
  meta: {
    status: 'completed',
    trip_id: 'test-trip-123',
    driver_id: 'test-driver-456',
    fare: {
      amount: 25.50,
      currency: 'USD'
    }
  }
};

const payloadString = JSON.stringify(payload);

// Generate HMAC-SHA256 signature (same algorithm Uber uses)
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(payloadString, 'utf8')
  .digest('hex');

console.log('🧪 Uber Webhook Test');
console.log('─'.repeat(50));
console.log(`Target URL: ${TARGET_URL}`);
console.log(`Event Type: ${payload.event_type}`);
console.log(`Event ID: ${payload.event_id}`);
console.log(`Signature: ${signature.substring(0, 20)}...`);
console.log('─'.repeat(50));

// Send the webhook
try {
  const response = await fetch(TARGET_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Uber-Signature': signature,
    },
    body: payloadString,
  });

  const data = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = data;
  }

  console.log(`\n📬 Response Status: ${response.status}`);
  console.log(`📦 Response Body:`, parsed);

  if (response.status === 200) {
    console.log('\n✅ Webhook test PASSED - Server accepted and verified the signature');
  } else if (response.status === 401) {
    console.log('\n❌ Webhook test FAILED - Signature verification failed');
    console.log('   Check that UBER_WEBHOOK_SECRET matches in both places');
  } else {
    console.log(`\n⚠️  Unexpected status code: ${response.status}`);
  }
} catch (err) {
  console.error('\n❌ Request failed:', err.message);
  if (err.cause?.code === 'ECONNREFUSED') {
    console.log('   Is the server running? Try: npm run dev');
  }
}
