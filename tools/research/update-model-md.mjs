
// tools/research/update-model-md.mjs
// Researches latest models from major providers and replaces MODEL.md
// Run with: node tools/research/update-model-md.mjs

import fs from 'fs/promises';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY or GOOGLE_API_KEY is not set in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-3-pro-preview',
  tools: [{ googleSearch: {} }]
});

async function researchProvider(providerName, focus) {
  console.log(`\n🔍 Researching ${providerName}...`);

  const query = `Research the absolute latest production models for ${providerName} as of December 2025.

REQUIREMENTS:
1. Find the NEWEST models available via API (including preview/research releases)
2. Provide EXACT API model IDs (strings used in code)
3. Provide EXACT API endpoint URLs
4. List all supported parameters with their exact names
5. Provide pricing (input/output per 1M tokens)
6. Context window sizes
7. Special capabilities (reasoning, JSON mode, vision, etc.)

${focus}

IMPORTANT: Verify all information is current and accurate. Use the Google Search tool.`;

  const systemPrompt = `You are a technical researcher specializing in LLM APIs.
Provide precise, verifiable information about AI Models.
Focus on exact API strings required for integration.
Do not speculate - only provide verified current information.`;

  try {
    const result = await model.generateContent(`CONTEXT: ${systemPrompt}\n\nTASK: ${query}`);
    const response = await result.response;
    const text = response.text();

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

    console.log(`✅ ${providerName} complete (${citations.length} sources)`);

    return {
      provider: providerName,
      answer: text,
      citations: [...new Set(citations.map(c => c.url))]
    };
  } catch (error) {
    console.error(`❌ Error researching ${providerName}:`, error.message);
    return {
      provider: providerName,
      answer: `Error: ${error.message}`,
      citations: []
    };
  }
}

async function generateCurlExamples(research) {
  console.log('\n🔨 Generating cURL examples...');

  const query = `Based on this research about AI models, generate complete, working cURL examples for each provider.

RESEARCH DATA:
${JSON.stringify(research.map(r => ({ provider: r.provider, summary: r.answer.substring(0, 500) })), null, 2)}

For each provider, create:
1. A basic cURL request example
2. An advanced example with all parameters
3. Show exact authentication headers
4. Show exact request body format

Make the examples copy-paste ready for testing.`;

  try {
    const result = await model.generateContent(query);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Error generating cURL examples:', error.message);
    return 'Error generating cURL examples';
  }
}

async function generateSDKExamples(research) {
  console.log('\n🔨 Generating SDK examples...');

  const query = `Based on this research about AI models, generate complete SDK examples in both Python and TypeScript.

RESEARCH DATA:
${JSON.stringify(research.map(r => ({ provider: r.provider, summary: r.answer.substring(0, 500) })), null, 2)}

For each provider, create:
1. Installation instructions (pip/npm)
2. Basic SDK usage example in Python
3. Basic SDK usage example in TypeScript
4. Advanced example with all parameters

Make the examples production-ready.`;

  try {
    const result = await model.generateContent(query);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('❌ Error generating SDK examples:', error.message);
    return 'Error generating SDK examples';
  }
}

async function main() {
  console.log('🚀 AI Model Research & MODEL.md Generator');
  console.log('==========================================');
  console.log(`Using: gemini-3-pro-preview with Google Search Grounding`);

  try {
    // Research each provider
    const providers = await Promise.all([
      researchProvider('Perplexity AI', 'Focus on Sonar Pro and Sonar models. Include search_recency_filter parameter.'),
      researchProvider('SerpAPI', 'Focus on the google_events engine and Google Search API integration.'),
      researchProvider('Google Gemini', 'Focus on gemini-3-pro-preview and gemini-2.5 family. Include thinking_level parameter.'),
      researchProvider('Anthropic Claude Opus', 'Focus on claude-opus-4-5-20251101. Include extended thinking parameters.'),
      researchProvider('Anthropic Claude Sonnet', 'Focus on claude-sonnet-4-5 and claude-3-7-sonnet. Include all supported parameters.'),
      researchProvider('OpenAI', 'Focus on GPT-5.1, o3, and o4-mini. Include reasoning_effort parameter and max_completion_tokens.')
    ]);

    // Generate examples
    const curlExamples = await generateCurlExamples(providers);
    const sdkExamples = await generateSDKExamples(providers);

    // Build MODEL.md
    const timestamp = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const totalCitations = providers.reduce((sum, p) => sum + p.citations.length, 0);

    const modelMD = `# AI Model Reference Guide

> **Last Updated:** ${timestamp}
> **Research Source:** Google Gemini 3.0 Pro Preview with Grounding (${totalCitations} citations)
> **Auto-generated:** This file is automatically generated by \`tools/research/update-model-md.mjs\`

---

## Table of Contents

1. [Perplexity AI](#perplexity-ai)
2. [SerpAPI](#serpapi)
3. [Google Gemini](#google-gemini)
4. [Anthropic Claude Opus](#anthropic-claude-opus)
5. [Anthropic Claude Sonnet](#anthropic-claude-sonnet)
6. [OpenAI](#openai)
7. [SDK Examples](#sdk-examples)
8. [API Key (cURL) Examples](#api-key-curl-examples)
9. [Citations](#citations)

---

${providers.map((p, i) => `
## ${p.provider}

${p.answer}

${p.citations.length > 0 ? `**Sources (${p.citations.length}):**\n${p.citations.map(url => `- ${url}`).join('\n')}` : ''}

---
`).join('\n')}

## SDK Examples

${sdkExamples}

---

## API Key (cURL) Examples

${curlExamples}

---

## Citations

**Total Sources:** ${totalCitations}

${providers.map(p => `
### ${p.provider}
${p.citations.map((url, i) => `${i + 1}. ${url}`).join('\n')}
`).join('\n')}

---

## Update Workflow

To refresh this documentation:

\`\`\`bash
node tools/research/update-model-md.mjs
\`\`\`

This script:
1. Uses Google Gemini 3.0 Pro with Search Grounding
2. Researches latest models from all major providers
3. Generates SDK examples (Python + TypeScript)
4. Generates cURL examples (API Key authentication)
5. Completely replaces MODEL.md with fresh data

---

*Auto-generated on ${new Date().toISOString()}*
`;

    // Write MODEL.md
    await fs.writeFile('MODEL.md', modelMD);

    console.log('\n✅ MODEL.md updated successfully!');
    console.log(`📄 Location: MODEL.md`);
    console.log(`📊 Providers researched: ${providers.length}`);
    console.log(`📚 Total citations: ${totalCitations}`);
    console.log(`🔍 Sections: Provider Details + SDK Examples + cURL Examples`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
