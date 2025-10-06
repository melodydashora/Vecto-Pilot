// Test script for multi-model LLM router
import 'dotenv/config';
import { routeLLMText } from '../server/lib/llm-router.js';

async function testRouter() {
  console.log('🧪 Testing Multi-Model LLM Router\n');
  
  // Simple test prompt
  const system = 'You are a helpful assistant. Be concise.';
  const user = 'Say "Hello from [provider name]" in 5 words or less.';
  
  console.log('📤 Sending test request...\n');
  console.log('System:', system);
  console.log('User:', user);
  console.log('\n' + '─'.repeat(60) + '\n');
  
  try {
    const result = await routeLLMText({ system, user });
    
    console.log('✅ Router Response:');
    console.log('─'.repeat(60));
    console.log(`Provider: ${result.provider}`);
    console.log(`Duration: ${result.tookMs}ms`);
    console.log(`Response: ${result.text || '(empty)'}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered:`);
      result.errors.forEach(err => console.log(`   - ${err}`));
    }
    
    console.log('\n' + '─'.repeat(60));
    
    if (result.provider === 'none') {
      console.log('\n❌ All providers failed!');
      process.exit(1);
    } else {
      console.log(`\n✅ Success! Provider "${result.provider}" responded in ${result.tookMs}ms`);
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testRouter();
