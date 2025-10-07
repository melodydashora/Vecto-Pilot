
#!/usr/bin/env node
// Model Discovery Script - Uses Perplexity to research latest AI models
// Outputs structured data for updating model configurations

import fs from 'fs/promises';
import path from 'path';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const MODEL = 'sonar-pro';

async function perplexitySearch(query, systemPrompt) {
  if (!PERPLEXITY_API_KEY) {
    throw new Error('PERPLEXITY_API_KEY not set');
  }

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      max_tokens: 2000,
      temperature: 0.1,
      search_recency_filter: 'month',
      return_related_questions: true,
      stream: false
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Perplexity API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return {
    answer: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
    relatedQuestions: data.choices?.[0]?.message?.related_questions || []
  };
}

async function researchProvider(providerName) {
  console.log(`\n🔍 Researching ${providerName}...`);
  
  const query = `What are the current production AI models from ${providerName} as of January 2025? 
  Include:
  1. Latest model names/IDs (exact strings for API calls)
  2. API endpoint URLs
  3. Required HTTP headers
  4. Supported parameters (temperature, max_tokens, etc.)
  5. Context window sizes
  6. Pricing per million tokens (input/output)
  7. Special features or constraints
  8. Any SDK package names
  
  Focus on models suitable for production use in chatbot/completion tasks.`;

  const systemPrompt = `You are a technical researcher specializing in AI/LLM APIs. 
  Provide precise, up-to-date information about production AI models.
  Include exact API endpoint URLs, model IDs, and parameter names.
  Format your response with clear sections for each piece of information.
  Only include information from official documentation or reliable tech sources from 2024-2025.`;

  const result = await perplexitySearch(query, systemPrompt);
  
  console.log(`✅ ${providerName} research complete (${result.citations.length} sources)`);
  
  return {
    provider: providerName,
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations,
    relatedQuestions: result.relatedQuestions
  };
}

async function researchParameterConstraints() {
  console.log(`\n🔍 Researching model parameter constraints...`);
  
  const query = `For OpenAI GPT-5, Anthropic Claude Sonnet 4.5, and Google Gemini 2.5 Pro:
  Which API parameters are supported vs deprecated?
  Specifically:
  - Does GPT-5 support temperature, top_p, frequency_penalty?
  - What parameters does GPT-5's reasoning_effort replace?
  - What are the valid values for reasoning_effort?
  - Are there any breaking changes from GPT-4 to GPT-5?
  - What parameters does Claude Sonnet 4.5 support?
  - What parameters does Gemini 2.5 Pro support?
  
  Provide exact parameter names and valid ranges.`;

  const systemPrompt = `You are an AI API expert. Provide precise information about API parameters.
  Focus on what's currently supported in production as of January 2025.
  Include any deprecation warnings or breaking changes.`;

  const result = await perplexitySearch(query, systemPrompt);
  
  console.log(`✅ Parameter research complete`);
  
  return {
    topic: 'parameter_constraints',
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations
  };
}

async function researchDeprecatedModels() {
  console.log(`\n🔍 Researching deprecated/superseded models...`);
  
  const query = `Which AI models have been deprecated or superseded in late 2024 and early 2025?
  For OpenAI, Anthropic, and Google AI:
  - Which older model names should no longer be used?
  - What are the recommended replacements?
  - Are there any sunset dates?
  
  Focus on models that were popular in 2024 but are now deprecated.`;

  const systemPrompt = `You are tracking AI model lifecycle. Provide information about deprecated models.
  Include exact old and new model names.
  Only include confirmed deprecations from official sources.`;

  const result = await perplexitySearch(query, systemPrompt);
  
  console.log(`✅ Deprecation research complete`);
  
  return {
    topic: 'deprecated_models',
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations
  };
}

async function generateReport(research) {
  const report = {
    generated_at: new Date().toISOString(),
    research_date: new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }),
    providers: research.providers,
    parameter_constraints: research.parameters,
    deprecated_models: research.deprecated,
    recommendations: generateRecommendations(research),
    next_steps: [
      'Review all findings against official documentation',
      'Update server/lib/adapters/* files with new model names',
      'Update docs/reference/LLM_MODELS_REFERENCE.md',
      'Update .env.example with new model defaults',
      'Test each model with tools/testing endpoints',
      'Update ISSUES.md if deprecated models are still in use'
    ]
  };

  return report;
}

function generateRecommendations(research) {
  const recommendations = [];
  
  // Check for common issues in the research
  const allText = JSON.stringify(research).toLowerCase();
  
  if (allText.includes('gpt-5') && allText.includes('reasoning_effort')) {
    recommendations.push({
      priority: 'HIGH',
      item: 'GPT-5 Parameter Update',
      detail: 'GPT-5 uses reasoning_effort instead of temperature. Update server/lib/adapters/openai-gpt5.js to remove unsupported parameters.'
    });
  }
  
  if (allText.includes('deprecated') || allText.includes('superseded')) {
    recommendations.push({
      priority: 'HIGH',
      item: 'Model Deprecation',
      detail: 'Some models may be deprecated. Review the deprecated_models section and update your codebase.'
    });
  }
  
  if (allText.includes('claude') && allText.includes('4.5')) {
    recommendations.push({
      priority: 'MEDIUM',
      item: 'Claude 4.5 Verification',
      detail: 'Verify Claude Sonnet 4.5 model ID matches what you have in server/lib/adapters/anthropic-sonnet45.js'
    });
  }
  
  return recommendations;
}

async function main() {
  console.log('🚀 AI Model Discovery & Research Tool');
  console.log('=====================================');
  console.log(`Using Perplexity model: ${MODEL}`);
  console.log(`Research date: ${new Date().toLocaleDateString()}`);
  
  try {
    // Research each provider
    const providers = await Promise.all([
      researchProvider('OpenAI'),
      researchProvider('Anthropic'),
      researchProvider('Google AI (Gemini)'),
      researchProvider('Perplexity AI')
    ]);
    
    // Research constraints and deprecations
    const parameters = await researchParameterConstraints();
    const deprecated = await researchDeprecatedModels();
    
    // Generate comprehensive report
    const report = await generateReport({
      providers,
      parameters,
      deprecated
    });
    
    // Save to file
    const outputDir = path.join(process.cwd(), 'tools', 'research');
    await fs.mkdir(outputDir, { recursive: true });
    
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(outputDir, `model-research-${timestamp}.json`);
    
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    
    console.log('\n✅ Research complete!');
    console.log(`📄 Report saved to: ${outputPath}`);
    
    // Print summary
    console.log('\n📊 Summary:');
    console.log(`- Providers researched: ${report.providers.length}`);
    console.log(`- Total citations: ${report.providers.reduce((sum, p) => sum + p.citations.length, 0) + report.parameter_constraints.citations.length + report.deprecated_models.citations.length}`);
    console.log(`- Recommendations: ${report.recommendations.length}`);
    
    if (report.recommendations.length > 0) {
      console.log('\n⚠️  Action Items:');
      report.recommendations.forEach(rec => {
        console.log(`  [${rec.priority}] ${rec.item}`);
        console.log(`      ${rec.detail}`);
      });
    }
    
    console.log('\n🔍 Review the full report for detailed findings and citations.');
    
  } catch (error) {
    console.error('❌ Research failed:', error.message);
    process.exit(1);
  }
}

main();
