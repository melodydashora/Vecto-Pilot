#!/usr/bin/env node
// Perplexity Search for Flagship AI Models
// Searches for latest production models with complete API details
// Run with: node tools/research/perplexity-flagship-search.mjs

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

if (!PERPLEXITY_API_KEY) {
  console.error('❌ PERPLEXITY_API_KEY not set in environment');
  process.exit(1);
}

async function searchPerplexity(query, model = 'sonar-reasoning-pro') {
  const url = 'https://api.perplexity.ai/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a technical AI researcher. Search for the NEWEST, most recent AI model releases. Do NOT default to older models. Provide exact API parameter names, endpoints, and values for the LATEST production models.'
        },
        {
          role: 'user',
          content: query
        }
      ],
      temperature: 0.2,
      top_p: 0.9,
      return_citations: false,
      search_recency_filter: 'week'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return {
    answer: data.choices[0].message.content,
    citations: data.citations || []
  };
}

function getTodayString() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

async function searchProvider(providerName) {
  console.log(`\n🔍 Searching ${providerName} flagship models...`);

  const today = getTodayString();

  const queries = {
    'OpenAI': `What are OpenAI's LATEST flagship models available via API as of ${today}?

List ONLY the newest models currently available. Do NOT include legacy or older generation models.

For EACH model provide:
- Model ID string
- Context window size
- Max output tokens
- Pricing per 1M tokens (input/output)
- Parameters: max_completion_tokens, reasoning_effort values
- Does "developer" role replace "system" role?

Also list the latest o-series reasoning models available now.

API endpoint: https://api.openai.com/v1/chat/completions
SDK: npm install openai / pip install openai`,

    'Anthropic': `What are Anthropic's LATEST Claude models available via API as of ${today}?

List ONLY the newest Claude models currently available. Do NOT include legacy or older generation models.

For EACH model provide:
- Model ID string with snapshot date
- Context window size (standard and extended)
- Max output tokens
- Pricing per 1M tokens (input/output/cache)
- Parameters: temperature, top_p, top_k
- Extended thinking / thinking block parameters
- Web search tool availability
- Capabilities (vision, function calling, PDF, computer use)

API endpoint: https://api.anthropic.com/v1/messages
Authentication: x-api-key header
SDK: npm install @anthropic-ai/sdk / pip install anthropic`,

    'Google': `What are Google's LATEST Gemini models available via API as of ${today}?

List ONLY the newest Gemini models currently available. Do NOT include legacy or older generation models.

For EACH model provide:
- Model ID string
- Context window size
- Max output tokens (maxOutputTokens)
- Pricing per 1M tokens
- Parameters: temperature, topP, topK
- Thinking parameters: thinkingConfig, thinkingLevel
- Google Search grounding configuration

API endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
SDK: npm install @google/generative-ai / pip install google-generativeai`,

    'Perplexity': `What are Perplexity AI's current flagship models as of ${today}?

Include ALL of the following with exact API details:

## Models to Research:
1. Sonar (sonar)
2. Sonar Pro (sonar-pro)
3. Sonar Reasoning (sonar-reasoning)
4. Sonar Reasoning Pro (sonar-reasoning-pro)
5. Sonar Deep Research
6. Any other current models

## For EACH model provide:
- **Model ID**: Exact API string
- **Context Window**: Tokens limit
- **Max Output Tokens**: Output limit
- **Pricing**:
  - Per 1M tokens (input/output)
  - Per 1,000 requests by search_context_size (low/medium/high)
- **Parameters**:
  - temperature (range)
  - top_p
  - search_recency_filter: values (hour/day/week/month)
  - return_citations: boolean
  - search_domain_filter: array of domains
  - search_context_size: low/medium/high
- **Capabilities**: citations, related questions, images

## API Details:
- **Endpoint**: https://api.perplexity.ai/chat/completions
- **Authentication**: Bearer token
- **SDK**: OpenAI-compatible (use openai SDK with base_url)`,

    'TomTom': `What are TomTom's current Traffic APIs as of ${today}?

## APIs to Research:
1. Traffic Flow API
2. Traffic Incidents API
3. Traffic Tiles API
4. Route Planning API

## For EACH API provide:
- **Endpoint**: Full URL pattern
- **Authentication**: API key parameter
- **Key Parameters**:
  - bbox or point coordinates
  - zoom levels
  - categories (incidents)
  - style (flow)
- **Response Format**: JSON structure
- **Rate Limits**: Requests per second
- **Pricing**: Per API call or tier

## Specifically for Traffic Incidents:
- How to get road closures
- How to filter by severity
- How to get delay information`,

    'Google Maps': `What are Google Maps Platform APIs we need for rideshare apps as of ${today}?

## APIs to Research:
1. Places API (New) - place details, hours, photos
2. Routes API - distance matrix, directions
3. Geocoding API - address to coordinates
4. Air Quality API
5. Weather API (if available via Google)

## For EACH API provide:
- **Endpoint**: Full URL
- **Authentication**: API key
- **Key Parameters**:
  - Places: fields mask, place_id
  - Routes: origins, destinations, traffic model
  - Geocoding: address vs latlng
- **Pricing**: Per 1,000 requests
- **Quotas**: Daily limits

## Places API New vs Legacy:
- What's the difference?
- Migration requirements
- Field mask syntax`
  };

  const result = await searchPerplexity(queries[providerName]);

  console.log(`✅ ${providerName} search complete (${result.citations.length} citations)`);

  return {
    provider: providerName,
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations
  };
}

async function searchParameterConstraints() {
  console.log(`\n🔍 Searching parameter constraints and breaking changes...`);

  const today = getTodayString();
  const query = `What are the critical parameter constraints and breaking changes for flagship AI models as of ${today}?

Focus on parameters that cause 400/401 errors if misconfigured:

## OpenAI GPT-5 / o-series:
- max_completion_tokens vs max_tokens - which models use which?
- reasoning_effort: exact valid values
- temperature: which models support it?
- "developer" role vs "system" role

## Anthropic Claude 4.5:
- Extended thinking parameters and headers
- Beta headers for 1M context (anthropic-beta values)
- Web search tool configuration

## Google Gemini 3.0:
- thinkingConfig format (nested vs flat)
- thinking_budget deprecation status
- Google Search grounding parameters

## Perplexity Sonar:
- search_context_size impact on pricing and quality
- search_recency_filter valid values

List ONLY confirmed breaking changes that cause API errors.`;

  const result = await searchPerplexity(query);

  console.log(`✅ Parameter constraints search complete`);

  return {
    topic: 'parameter_constraints',
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations
  };
}

async function searchSDKExamples() {
  console.log(`\n🔍 Searching SDK and cURL examples...`);

  const today = getTodayString();
  const query = `Provide working code examples for the latest AI model APIs as of ${today}:

## OpenAI GPT-5.2 Example:
- cURL with all required headers
- Node.js with openai SDK
- Python with openai SDK
- Show reasoning_effort and max_completion_tokens

## Anthropic Claude Opus 4.5 Example:
- cURL with x-api-key and anthropic-version headers
- Node.js with @anthropic-ai/sdk
- Python with anthropic SDK
- Show web_search tool usage

## Google Gemini 3 Pro Preview Example:
- cURL with API key
- Node.js with @google/generative-ai
- Python with google-generativeai
- Show thinkingConfig and Google Search grounding

## Perplexity Sonar Pro Example:
- cURL with Bearer auth
- Using OpenAI SDK with custom base_url
- Show search_recency_filter and return_citations

Make examples production-ready with error handling.`;

  const result = await searchPerplexity(query);

  console.log(`✅ SDK examples search complete`);

  return {
    topic: 'sdk_examples',
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations
  };
}

async function main() {
  console.log('🚀 Perplexity Flagship Model Search');
  console.log('====================================');
  console.log('Using: Perplexity Sonar Reasoning Pro (search_recency: week)\n');

  try {
    // Search each provider in parallel
    const providerResults = await Promise.all([
      searchProvider('OpenAI'),
      searchProvider('Anthropic'),
      searchProvider('Google'),
      searchProvider('Perplexity'),
      searchProvider('TomTom'),
      searchProvider('Google Maps')
    ]);

    // Search parameter constraints and SDK examples
    const [parameterResults, sdkResults] = await Promise.all([
      searchParameterConstraints(),
      searchSDKExamples()
    ]);

    // Generate report
    const report = {
      generated_at: new Date().toISOString(),
      research_date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      tool_used: 'Perplexity Sonar Reasoning Pro',
      providers: providerResults,
      parameter_constraints: parameterResults,
      sdk_examples: sdkResults,
      total_citations: providerResults.reduce((sum, p) => sum + p.citations.length, 0) +
                       parameterResults.citations.length +
                       sdkResults.citations.length,
      summary: {
        providers_searched: providerResults.length,
        total_sources: providerResults.reduce((sum, p) => sum + p.citations.length, 0) +
                       parameterResults.citations.length +
                       sdkResults.citations.length
      }
    };

    // Save to file
    const outputDir = path.join(process.cwd(), 'tools', 'research');
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(outputDir, `flagship-models-${timestamp}.json`);

    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

    console.log('\n✅ Search complete!');
    console.log(`📄 Report saved to: ${outputPath}`);
    console.log(`\n📊 Summary:`);
    console.log(`- Providers searched: ${report.summary.providers_searched}`);
    console.log(`- Total citations: ${report.summary.total_sources}`);
    console.log(`\n💡 Next steps:`);
    console.log('- Run: node tools/research/parse-flagship-json.mjs');
    console.log('- This will auto-detect the latest JSON and generate MODEL.md');

  } catch (error) {
    console.error('❌ Search failed:', error.message);
    process.exit(1);
  }
}

main();
