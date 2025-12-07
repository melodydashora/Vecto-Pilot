
#!/usr/bin/env node

import 'dotenv/config';
import { routeLLMTextV2 } from '../../server/lib/llm-router-v2.js';

const modelTests = [
  // GPT-5 family
  { modelKey: 'gpt-5', modelParam: 'minimal', description: 'GPT-5 (minimal reasoning)' },
  { modelKey: 'gpt-5', modelParam: 'low', description: 'GPT-5 (low reasoning)' },
  { modelKey: 'gpt-5', modelParam: 'medium', description: 'GPT-5 (medium reasoning)' },
  { modelKey: 'gpt-5', modelParam: 'high', description: 'GPT-5 (high reasoning)' },
  
  // GPT-5.1 family (newer model with better performance)
  { modelKey: 'gpt-5.1', modelParam: 'minimal', description: 'GPT-5.1 (minimal reasoning)' },
  { modelKey: 'gpt-5.1', modelParam: 'low', description: 'GPT-5.1 (low reasoning)' },
  { modelKey: 'gpt-5.1', modelParam: 'medium', description: 'GPT-5.1 (medium reasoning)' },
  { modelKey: 'gpt-5.1', modelParam: 'high', description: 'GPT-5.1 (high reasoning)' },
  
  // Claude Sonnet 4.5 (temperature-based)
  { modelKey: 'claude', modelParam: '0.0', description: 'Claude Sonnet 4.5 (temp 0.0 - deterministic)' },
  { modelKey: 'claude', modelParam: '0.2', description: 'Claude Sonnet 4.5 (temp 0.2)' },
  { modelKey: 'claude', modelParam: '0.5', description: 'Claude Sonnet 4.5 (temp 0.5)' },
  { modelKey: 'claude', modelParam: '1.0', description: 'Claude Sonnet 4.5 (temp 1.0 - creative)' },
  
  // Gemini 2.5 Pro (temperature-based)
  { modelKey: 'gemini', modelParam: '0.0', description: 'Gemini 2.5 Pro (temp 0.0 - deterministic)' },
  { modelKey: 'gemini', modelParam: '0.2', description: 'Gemini 2.5 Pro (temp 0.2)' },
  { modelKey: 'gemini', modelParam: '0.5', description: 'Gemini 2.5 Pro (temp 0.5)' },
  { modelKey: 'gemini', modelParam: '1.0', description: 'Gemini 2.5 Pro (temp 1.0 - creative)' },
];

// Model family to provider mapping
const modelToProvider = {
  'gpt-5': 'openai',
  'gpt-5.1': 'openai',
  'claude': 'anthropic',
  'gemini': 'google'
};

// Model family to actual model ID mapping
const modelToModelId = {
  'gpt-5': 'gpt-5',
  'gpt-5.1': 'gpt-5.1-2025-11-13',
  'claude': 'claude-sonnet-4-5-20250929',
  'gemini': 'gemini-2.5-pro'
};

async function testModel(config) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Testing: ${config.description}`);
  console.log(`${'='.repeat(80)}\n`);
  
  const system = 'You are a helpful rideshare strategy assistant. Be concise.';
  const user = 'What are the top 3 factors for rideshare success in Frisco, TX on a Friday afternoon?';
  
  console.log(`📤 Prompt: "${user}"\n`);
  
  try {
    const providerKey = modelToProvider[config.modelKey];
    const modelId = modelToModelId[config.modelKey];
    
    // Temporarily override environment variables for this test
    const originalModel = process.env[`${providerKey.toUpperCase()}_MODEL`];
    const originalParam = process.env._OVERRIDE_LLM_PARAM;
    
    // Set model-specific overrides
    if (providerKey === 'openai') {
      process.env.OPENAI_MODEL = modelId;
      process.env._OVERRIDE_LLM_PARAM = config.modelParam; // reasoning_effort
    } else if (providerKey === 'anthropic') {
      process.env.ANTHROPIC_MODEL = modelId;
      process.env._OVERRIDE_LLM_PARAM = config.modelParam; // temperature
    } else if (providerKey === 'google') {
      process.env.GEMINI_MODEL = modelId;
      process.env._OVERRIDE_LLM_PARAM = config.modelParam; // temperature
    }
    
    const result = await routeLLMTextV2({ 
      system, 
      user, 
      log: console,
      overrides: {
        modelKey: config.modelKey,
        modelParam: config.modelParam
      }
    });
    
    // Restore original environment
    if (originalModel) {
      process.env[`${providerKey.toUpperCase()}_MODEL`] = originalModel;
    }
    if (originalParam) {
      process.env._OVERRIDE_LLM_PARAM = originalParam;
    } else {
      delete process.env._OVERRIDE_LLM_PARAM;
    }
    
    console.log(`\n✅ Response (${result.tookMs}ms from ${result.provider}):`);
    console.log(`${'─'.repeat(80)}`);
    console.log(result.text);
    console.log(`${'─'.repeat(80)}\n`);
    
    return {
      config: config.description,
      provider: result.provider,
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
  console.log('🚀 Starting model family comparison tests\n');
  
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
  
  // Group by model family
  const families = {
    'GPT-5': results.filter(r => r.config.includes('GPT-5 ')),
    'GPT-5.1': results.filter(r => r.config.includes('GPT-5.1')),
    'Claude': results.filter(r => r.config.includes('Claude')),
    'Gemini': results.filter(r => r.config.includes('Gemini'))
  };
  
  for (const [family, familyResults] of Object.entries(families)) {
    if (familyResults.length === 0) continue;
    
    console.log(`\n📦 ${family}:`);
    for (const result of familyResults) {
      if (result.success) {
        console.log(`  ✅ ${result.config}: ${result.duration}ms (${result.length} chars)`);
      } else {
        console.log(`  ❌ ${result.config}: ${result.error}`);
      }
    }
  }
  
  console.log('\n✅ All tests complete!\n');
}

// Check if specific model was requested
const args = process.argv.slice(2);
if (args.length > 0) {
  const modelKey = args[0];
  const modelParam = args[1] || (modelKey.startsWith('gpt') ? 'medium' : '0.5');
  
  testModel({
    modelKey,
    modelParam,
    description: `${modelKey} with param ${modelParam}`
  });
} else {
  runAllTests();
}
