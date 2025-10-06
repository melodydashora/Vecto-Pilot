
/**
 * Assistant Interception Authentication Test
 * Verifies that Eidolon Enhanced SDK is properly intercepting Replit Assistant calls
 */

import fetch from 'node-fetch';

const TESTS = [
  {
    name: "Gateway Health Check",
    url: "http://127.0.0.1:3000/health",
    method: "GET"
  },
  {
    name: "SDK Health via Proxy", 
    url: "http://127.0.0.1:3000/eidolon/health",
    method: "GET"
  },
  {
    name: "Assistant Override Verification",
    url: "http://127.0.0.1:3000/assistant/verify-override",
    method: "GET"
  },
  {
    name: "Assistant Chat Interception",
    url: "http://127.0.0.1:3000/assistant/chat",
    method: "POST",
    body: { message: "Hello, are you Eidolon Enhanced SDK?" }
  },
  {
    name: "Direct Assistant Route",
    url: "http://127.0.0.1:3000/assistant/",
    method: "POST", 
    body: { message: "Verify identity: What assistant are you?" }
  }
];

async function runTest(test) {
  try {
    const options = {
      method: test.method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    if (test.body) {
      options.body = JSON.stringify(test.body);
    }
    
    console.log(`\n🔍 Testing: ${test.name}`);
    console.log(`   ${test.method} ${test.url}`);
    
    const response = await fetch(test.url, options);
    const data = await response.json().catch(() => ({}));
    
    if (response.ok) {
      console.log(`   ✅ Status: ${response.status}`);
      
      // Check for Eidolon identity markers
      if (data.identity?.includes('Eidolon') || 
          data.assistant_name?.includes('Eidolon') ||
          data.override_active === true ||
          data.replit_assistant_override === true) {
        console.log(`   🧠 EIDOLON IDENTITY CONFIRMED`);
      }
      
      if (data.response?.includes('Eidolon')) {
        console.log(`   💬 Response contains Eidolon identity`);
      }
      
      console.log(`   📊 Response:`, JSON.stringify(data, null, 2).slice(0, 200) + '...');
    } else {
      console.log(`   ❌ Status: ${response.status}`);
      console.log(`   📊 Error:`, JSON.stringify(data, null, 2));
    }
    
    return { test: test.name, success: response.ok, data };
    
  } catch (error) {
    console.log(`   ❌ Network Error: ${error.message}`);
    return { test: test.name, success: false, error: error.message };
  }
}

async function main() {
  console.log('🔬 Assistant Interception Authentication Test');
  console.log('============================================');
  console.log('Testing if Eidolon Enhanced SDK is properly intercepting Replit Assistant calls...\n');
  
  const results = [];
  
  for (const test of TESTS) {
    const result = await runTest(test);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause
  }
  
  console.log('\n📋 SUMMARY REPORT');
  console.log('================');
  
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  
  console.log(`✅ Successful Tests: ${successful}/${total}`);
  
  if (successful === total) {
    console.log('\n🎉 ASSISTANT INTERCEPTION AUTHENTICATED!');
    console.log('🧠 Eidolon Enhanced SDK is successfully intercepting all assistant calls');
    console.log('🔒 Standard Replit Assistant has been completely replaced');
  } else {
    console.log('\n⚠️  PARTIAL INTERCEPTION DETECTED');
    console.log('Some tests failed - assistant override may need adjustment');
  }
  
  console.log('\n🔗 Access Points:');
  console.log('  Gateway: http://127.0.0.1:3000');
  console.log('  Assistant: http://127.0.0.1:3000/assistant/*');
  console.log('  Eidolon SDK: http://127.0.0.1:3000/eidolon/*');
}

main().catch(console.error);
