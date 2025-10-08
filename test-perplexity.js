
#!/usr/bin/env node
import 'dotenv/config';
import { PerplexityResearch } from './server/lib/perplexity-research.js';

const perplexity = new PerplexityResearch();

console.log('🧪 Testing Perplexity Research Module');
console.log('=====================================\n');

// Test 1: Basic search
console.log('Test 1: Basic Search Query');
console.log('-------------------------');
const result = await perplexity.search('What is the latest news about AI development in 2025?', {
  maxTokens: 300,
  temperature: 0.2
});

console.log('✅ Answer:', result.answer.substring(0, 200) + '...');
console.log('📚 Citations:', result.citations?.length || 0);
console.log('🤖 Model:', result.model);
console.log('');

// Test 2: Flight disruption research
console.log('Test 2: Airport Disruption Check');
console.log('--------------------------------');
const disruption = await perplexity.researchFlightDisruptions('DFW', 'Dallas Fort Worth International');

console.log('✅ Airport:', disruption.airport_code);
console.log('📝 Summary:', disruption.summary);
console.log('⚠️  Impact Level:', disruption.impact_level);
console.log('');

console.log('🎉 All tests completed successfully!');
