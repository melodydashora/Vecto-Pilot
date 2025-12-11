
// Perplexity Search for Flagship AI Models
// Searches for latest production models with beta/preview variants
// Run with: node tools/research/perplexity-flagship-search.mjs

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

if (!PERPLEXITY_API_KEY) {
  console.error('❌ PERPLEXITY_API_KEY not set in environment');
  process.exit(1);
}

async function searchPerplexity(query, model = 'sonar-pro') {
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
          content: 'You are a technical AI researcher. Provide precise, structured information about production AI models with exact API parameter names and values. Include beta and preview models.'
        },
        {
          role: 'user',
          content: query
        }
      ],
      temperature: 0.2,
      top_p: 0.9,
      return_citations: true,
      search_recency_filter: 'month'
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

async function searchProvider(providerName) {
  console.log(`\n🔍 Searching ${providerName} flagship models...`);

  const queries = {
    'OpenAI': `What are OpenAI's current flagship models as of December 2025?

Include ALL of the following with exact API strings:
1. GPT-5 variants (gpt-5, gpt-5.1, gpt-5-mini, gpt-5-nano)
2. o-series reasoning models (o1, o1-pro, o3, o4-mini) - include snapshots
3. GPT-4 Turbo (if still available)

For EACH model provide:
- Exact API model ID string (e.g., "gpt-5.1-2025-11-13")
- Context window (tokens)
- Max output tokens
- Supported parameters (reasoning_effort, temperature, max_completion_tokens vs max_tokens)
- Pricing per 1M tokens (input/output)
- Beta/Preview status
- Special capabilities (vision, function calling, JSON mode, structured outputs)`,

    'Anthropic': `What are Anthropic's current flagship models as of December 2025?

Include ALL of the following with exact API strings:
1. Claude Opus 4.5 (all snapshots including 20251124, 20251101)
2. Claude Sonnet 4.5 (all snapshots)
3. Claude Haiku 4.5
4. Claude 3.7 Sonnet (if available)
5. Any extended thinking variants

For EACH model provide:
- Exact API model ID (e.g., "claude-opus-4-5-20251124")
- Context window (standard vs extended/beta)
- Max output tokens
- Supported parameters (thinking, temperature, top_p, top_k)
- Pricing per 1M tokens
- Beta/Preview features (extended thinking, 1M context)
- Anthropic-version header requirements`,

    'Google': `What are Google's current flagship Gemini models as of December 2025?

Include ALL of the following with exact API strings:
1. Gemini 3.0 Pro (preview and stable)
2. Gemini 2.5 Pro
3. Gemini 2.5 Flash
4. Gemini 2.0 Flash (if available)
5. Any experimental/preview variants

For EACH model provide:
- Exact API model ID (e.g., "gemini-3-pro-preview", "gemini-2.5-pro")
- Context window
- Max output tokens (maxOutputTokens)
- Supported parameters (temperature, topP, topK, thinking_level, thinking_budget)
- Pricing per 1M tokens (tiered pricing if applicable)
- Google Search grounding support
- Beta/Preview status`,

    'Perplexity': `What are Perplexity AI's current flagship models as of December 2025?

Include ALL of the following with exact API strings:
1. Sonar variants (sonar, sonar-pro)
2. Sonar Reasoning variants (sonar-reasoning, sonar-reasoning-pro)
3. Sonar Deep Research
4. Any preview/experimental models

For EACH model provide:
- Exact API model ID
- Context window
- Token pricing (input/output per 1M)
- Request fees per 1,000 requests by search_context_size (low/medium/high)
- Supported parameters (search_recency_filter, return_citations, search_domain_filter)
- Special features (citations, related questions, images)`
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

  const query = `What are the critical parameter constraints and breaking changes for flagship AI models in December 2025?

Focus on:
1. **OpenAI GPT-5/o-series**: max_completion_tokens vs max_tokens, reasoning_effort values, temperature support
2. **Anthropic Claude 4.5**: Extended thinking parameters, beta headers for 1M context, temperature vs top_p conflicts
3. **Google Gemini 3.0**: thinking_level vs thinking_budget, parameter deprecations, grounding parameters
4. **Perplexity Sonar**: search_context_size impact on pricing, citation parameters

List ONLY confirmed breaking changes that cause 400/401 errors if misconfigured.`;

  const result = await searchPerplexity(query);
  
  console.log(`✅ Parameter constraints search complete`);
  
  return {
    topic: 'parameter_constraints',
    timestamp: new Date().toISOString(),
    answer: result.answer,
    citations: result.citations
  };
}

async function main() {
  console.log('🚀 Perplexity Flagship Model Search');
  console.log('====================================');
  console.log('Using: Perplexity Sonar Pro with web search\n');

  try {
    // Search each provider in parallel
    const providerResults = await Promise.all([
      searchProvider('OpenAI'),
      searchProvider('Anthropic'),
      searchProvider('Google'),
      searchProvider('Perplexity')
    ]);

    // Search parameter constraints
    const parameterResults = await searchParameterConstraints();

    // Generate report
    const report = {
      generated_at: new Date().toISOString(),
      research_date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      tool_used: 'Perplexity Sonar Pro',
      providers: providerResults,
      parameter_constraints: parameterResults,
      total_citations: providerResults.reduce((sum, p) => sum + p.citations.length, 0) + parameterResults.citations.length,
      summary: {
        providers_searched: providerResults.length,
        total_sources: providerResults.reduce((sum, p) => sum + p.citations.length, 0) + parameterResults.citations.length
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
    console.log('- Review the JSON output for exact model IDs');
    console.log('- Update server/lib/ai/models-dictionary.js with new models');
    console.log('- Run: node tools/research/generate-model-md.mjs to update MODEL.md');

  } catch (error) {
    console.error('❌ Search failed:', error.message);
    process.exit(1);
  }
}

main();
