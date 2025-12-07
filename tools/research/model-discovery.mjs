// Model Discovery Script - Uses Google Gemini 3.0 to research latest AI models
// Outputs structured data for updating model configurations
// Run with: node tools/research/model-discovery.mjs

import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Google AI - try both environment variable names
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// UPDATED: Using the latest Gemini 3 Pro Preview (Released Nov 2025)
const MODEL_NAME = 'gemini-3-pro-preview'; 

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY or GOOGLE_API_KEY is not set in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  tools: [{ googleSearch: {} }] // Enable Google Search Grounding
});

async function performGroundedResearch(query, systemPrompt) {
  try {
    // Combine context and query for the generative model
    // Gemini 3.0 benefits from explicit "Thinking" instructions in the prompt
    const combinedPrompt = `
      CONTEXT: ${systemPrompt}

      TASK: ${query}

      REQUIREMENT: Use the Google Search tool to verify all technical details, version numbers, and parameters.
      Ensure you verify the exact API strings (e.g., 'gemini-3-pro-preview' vs 'gemini-3-pro').
    `;

    const result = await model.generateContent(combinedPrompt);
    const response = await result.response;
    const text = response.text();

    // Extract grounding metadata to form citations
    const citations = [];
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

    if (groundingMetadata?.groundingChunks) {
      groundingMetadata.groundingChunks.forEach((chunk) => {
        if (chunk.web?.uri) {
          citations.push({
            title: chunk.web.title || 'Source',
            url: chunk.web.uri
          });
        }
      });
    }

    return {
      answer: text,
      citations: [...new Set(citations.map(c => c.url))], // Deduplicate URLs
      relatedQuestions: [] 
    };

  } catch (error) {
    throw new Error(`Google Gemini API error: ${error.message}`);
  }
}

async function researchProvider(providerName) {
  console.log(`\n🔍 Researching ${providerName} via Google Grounding...`);

  let query, systemPrompt;

  if (providerName === 'News & Events APIs') {
    query = `Compare the following APIs for finding LOCAL events (concerts, games, comedy) within a 50-mile radius TODAY.

    1. **Google Search via Gemini API**
       - How to prompt Gemini 3.0 with Google Search to return structured event JSON?
       - Does the "Thinking" capability improve location filtering?

    2. **SerpAPI (Google Events Engine)**
       - Parameter \`engine=google_events\`
       - Filtering for "Today" (\`htichips=date:today\`)
       - Location parameter format (\`location=...\`)

    3. **Ticketmaster Discovery API**
       - \`latlong\` and \`radius\` parameters.
       - \`startDateTime\` and \`endDateTime\` formatting.

    Provide exact parameter names, API endpoint URLs, and a comparison of data freshness for "Today".`;

    systemPrompt = `You are an expert on Event Discovery APIs.
    Provide precise, current parameters for finding hyperlocal events.
    Focus on exact API parameters (JSON keys, URL params).
    Cite official documentation or developer portals.`;

  } else {
    // UPDATED QUERY: Recognizes Gemini 3 is out, looks for competitors/updates
    query = `What are the current production AI models from ${providerName} available via API as of December 2025?

    Include:
    1. Latest specific Model IDs (exact strings for API calls).
    2. API Endpoint URLs.
    3. Supported features (Function calling, JSON mode, Vision, Reasoning).
    4. Context window sizes.
    5. Pricing (Input/Output per 1M tokens).

    Verify the existence and API names of:
    - OpenAI: Latest o1 (reasoning) versions or GPT-5 snapshots.
    - Anthropic: Claude 3.5 Opus or Claude 3.7 Sonnet (if released).
    - Google: Verify "gemini-3-pro-preview" parameters and any newer "Flash" variants.

    Focus on valid, production-ready strings used in code.`;

    systemPrompt = `You are a technical researcher specializing in LLM integrations.
    Provide precise, verifiable information about AI Models.
    Do not speculate. Focus on the exact API strings required for integration.`;
  }

  const result = await performGroundedResearch(query, systemPrompt);

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

  // UPDATED QUERY: Focuses on Gemini 3 "Thinking" and OpenAI "o1" changes
  const query = `Compare API parameter constraints for the latest models (Dec 2025):

  1. **Google Gemini 3.0 Pro Preview**
     - What is the \`thinking_level\` parameter? (low/high)
     - Does it still support \`thinking_budget\` or is that deprecated?
     - Are there breaking changes regarding "thought signatures" in function calling?

  2. **OpenAI (o1 / GPT-5)**
     - Confirmation of \`max_completion_tokens\` vs \`max_tokens\`.
     - Is \`temperature\` supported in the latest reasoning models?

  3. **Anthropic (Claude 3.5/3.7)**
     - Latest \`anthropic-version\` header date.

  Provide a table of breaking changes for these newest models.`;

  const systemPrompt = `You are an API integration specialist.
  Focus on BREAKING CHANGES in parameters for the absolute latest models (Gemini 3.0, OpenAI o1).
  Identify parameters that must be omitted to avoid 400 Bad Request errors.`;

  const result = await performGroundedResearch(query, systemPrompt);

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

  const query = `Which major LLM API models have been deprecated or are scheduled for sunset in late 2025?

  Check specific status for:
  - OpenAI: gpt-3.5 series, older gpt-4-turbo snapshots.
  - Google: gemini-1.0-pro, gemini-1.5-pro-preview-0409 (specific old snapshots).
  - Anthropic: Claude 2.1.

  Provide exact dates for shutdown if available.`;

  const systemPrompt = `You are tracking software lifecycles.
  List only confirmed deprecations from official changelogs.`;

  const result = await performGroundedResearch(query, systemPrompt);

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
    tool_used: 'Google Gemini 3.0 Pro Preview',
    providers: research.providers,
    parameter_constraints: research.parameters,
    deprecated_models: research.deprecated,
    recommendations: generateRecommendations(research),
    next_steps: [
      'Update server/lib/adapters/google-gemini.js to use "gemini-3-pro-preview"',
      'Implement `thinking_level` parameter logic for Gemini 3 adapter',
      'Verify "thought_signature" handling in multi-turn function calls',
      'Update OpenAI adapter for `max_completion_tokens`'
    ]
  };

  return report;
}

function generateRecommendations(research) {
  const recommendations = [];

  try {
    const allText = JSON.stringify(research).toLowerCase();

    // Logic to detect specific API shifts based on keyword presence in the research
    if (allText.includes('thinking_level') || allText.includes('thought_signature')) {
      recommendations.push({
        priority: 'CRITICAL',
        item: 'Gemini 3.0 Reasoning Update',
        detail: 'Gemini 3.0 requires handling of `thinking_level` and strict `thought_signature` passing in function calls. Existing adapters may break on multi-turn tool use.',
      });
    }

    if (allText.includes('max_completion_tokens')) {
      recommendations.push({
        priority: 'HIGH',
        item: 'OpenAI o1 Parameter Shift',
        detail: 'Ensure OpenAI reasoning models use `max_completion_tokens` instead of `max_tokens`.'
      });
    }

    if (allText.includes('deprecated') && allText.includes('1.0-pro')) {
      recommendations.push({
        priority: 'MEDIUM',
        item: 'Legacy Model Cleanup',
        detail: 'Remove references to Gemini 1.0 Pro or older PaLM models if confirmed deprecated.'
      });
    }

    return recommendations;
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return [];
  }
}

async function main() {
  console.log('🚀 AI Model Discovery & Research Tool (Powered by Google Gemini 3.0)');
  console.log('====================================================================');
  console.log(`Using Model: ${MODEL_NAME}`);

  try {
    // Research each provider
    const providers = await Promise.all([
      researchProvider('OpenAI'),
      researchProvider('Anthropic'),
      researchProvider('Google AI (Gemini)'),
      researchProvider('News & Events APIs')
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
    console.log(`- Total sources cited: ${report.providers.reduce((sum, p) => sum + p.citations.length, 0) + report.parameter_constraints.citations.length}`);

    if (report.recommendations.length > 0) {
      console.log('\n⚠️  Action Items:');
      report.recommendations.forEach(rec => {
        console.log(`  [${rec.priority}] ${rec.item}`);
        console.log(`      ${rec.detail}`);
      });
    }

  } catch (error) {
    console.error('❌ Research failed:', error);
    process.exit(1);
  }
}

main();
