#!/usr/bin/env node
// Test the v2 router directly

import 'dotenv/config';
import { routeLLMTextV2 } from '../../server/lib/llm-router-v2.js';

async function testV2Router() {
  console.log('🧪 Testing V2 Multi-Model LLM Router\n');
  
  const system = 'You are a helpful assistant. Be concise.';
  const user = 'Say "Hello from [provider name]" in 5 words or less.';
  
  console.log('📤 Sending test request...\n');
  console.log(`System: ${system}`);
  console.log(`User: ${user}\n`);
  console.log('─'.repeat(60));
  
  try {
    const result = await routeLLMTextV2({ system, user, log: console });
    
    console.log('\n✅ V2 Router Response:');
    console.log('─'.repeat(60));
    console.log(`Provider: ${result.provider}`);
    console.log(`Duration: ${result.tookMs}ms`);
    console.log(`Response: ${result.text}`);
    if (result.errors && result.errors.length > 0) {
      console.log(`Errors: ${JSON.stringify(result.errors, null, 2)}`);
    }
    console.log('─'.repeat(60));
    
    if (!result.text) {
      console.error('\n❌ Empty response!');
      process.exit(1);
    }
    
    console.log(`\n✅ Success! Provider "${result.provider}" responded in ${result.tookMs}ms`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

testV2Router();
