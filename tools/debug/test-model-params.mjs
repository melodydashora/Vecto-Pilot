
#!/usr/bin/env node

import 'dotenv/config';
import { routeLLMTextV2 } from '../../server/lib/llm-router-v2.js';

const modelTests = [
  // Gemini temperature tests
  { modelKey: 'gemini', modelParam: '0.0', description: 'Gemini (temp 0.0 - deterministic)' },
  { modelKey: 'gemini', modelParam: '0.2', description: 'Gemini (temp 0.2 - slight creativity)' },
  { modelKey: 'gemini', modelParam: '0.5', description: 'Gemini (temp 0.5 - balanced)' },
  { modelKey: 'gemini', modelParam: '1.0', description: 'Gemini (temp 1.0 - creative)' },
  
  // Claude temperature tests
  { modelKey: 'claude', modelParam: '0.0', description: 'Claude (temp 0.0 - deterministic)' },
  { modelKey: 'claude', modelParam: '0.2', description: 'Claude (temp 0.2 - slight creativity)' },
  { modelKey: 'claude', modelParam: '1.0', description: 'Claude (temp 1.0 - creative)' },
  
  // GPT-5 reasoning effort tests
  { modelKey: 'gpt-5', modelParam: 'minimal', description: 'GPT-5 (minimal reasoning - fastest)' },
  { modelKey: 'gpt-5', modelParam: 'low', description: 'GPT-5 (low reasoning)' },
  { modelKey: 'gpt-5', modelParam: 'medium', description: 'GPT-5 (medium reasoning - balanced)' },
  { modelKey: 'gpt-5', modelParam: 'high', description: 'GPT-5 (high reasoning - deepest)' },
];

async function testModel(config) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Testing: ${config.description}`);
  console.log(`${'='.repeat(80)}\n`);
  
  const system = 'You are a helpful rideshare strategy assistant. Be concise.';
  const user = 'What are the top 3 factors for rideshare success in Frisco, TX on a Friday afternoon?';
  
  console.log(`📤 Prompt: "${user}"\n`);
  
  try {
    const result = await routeLLMTextV2({ 
      system, 
      user, 
      log: console,
      overrides: {
        modelKey: config.modelKey,
        modelParam: config.modelParam
      }
    });
    
    console.log(`\n✅ Response (${result.tookMs}ms):`);
    console.log(`${'─'.repeat(80)}`);
    console.log(result.text);
    console.log(`${'─'.repeat(80)}\n`);
    
    return {
      config: config.description,
      duration: result.tookMs,
      length: result.text.length,
      success: true
    };
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    return {
      config: config.description,
      error: error.message,
      success: false
    };
  }
}

async function runAllTests() {
  console.log('🚀 Starting model parameter comparison tests\n');
  
  const results = [];
  for (const config of modelTests) {
    const result = await testModel(config);
    results.push(result);
    
    // Wait between tests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 SUMMARY');
  console.log(`${'='.repeat(80)}\n`);
  
  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.config}: ${result.duration}ms (${result.length} chars)`);
    } else {
      console.log(`❌ ${result.config}: ${result.error}`);
    }
  }
  
  console.log('\n✅ All tests complete!\n');
}

// Check if specific model was requested
const args = process.argv.slice(2);
if (args.length > 0) {
  const modelKey = args[0];
  const modelParam = args[1] || '0.0';
  
  testModel({
    modelKey,
    modelParam,
    description: `${modelKey} with param ${modelParam}`
  });
} else {
  runAllTests();
}
