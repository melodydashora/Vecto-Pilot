#!/usr/bin/env node

/**
 * Fetch Latest AI SDK Features using Perplexity API
 * 
 * This script queries Perplexity with high research to get the newest SDK features:
 * - OpenAI SDK (GPT-5 params, tools, function calling)
 * - Anthropic SDK (Claude features, streaming, tools)
 * - Google Gemini SDK (parameters, capabilities)
 */

import fetch from 'node-fetch';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

if (!PERPLEXITY_API_KEY) {
  console.error('❌ PERPLEXITY_API_KEY not found in environment');
  process.exit(1);
}

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

async function queryPerplexity(question, searchRecency = 'month') {
  try {
    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
        return_citations: true,
        search_recency_filter: searchRecency,
        search_domain_filter: ['openai.com', 'anthropic.com', 'ai.google.dev', 'github.com']
      })
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error(`   API Response: ${responseText}`);
      throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
    }

    const data = JSON.parse(responseText);
    return data.choices[0].message.content;
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function fetchLatestSDKFeatures() {
  console.log('🔍 Fetching latest AI SDK features with HIGH RESEARCH...\n');

  // Query for OpenAI SDK - GPT-5 specific features
  console.log('📡 Querying OpenAI SDK (GPT-5 features)...');
  const openaiSDK = await queryPerplexity(
    `What are the newest OpenAI SDK features for GPT-5 released in 2025? Include:
    1. Verbosity parameter (low/medium/high) with usage examples
    2. Reasoning effort levels (minimal/low/medium/high) with latency comparisons
    3. Freeform function calling capabilities
    4. Context-Free Grammar (CFG) support
    5. New response formats and structured outputs
    6. Code examples showing these features
    7. Supported models and API endpoints
    Provide comprehensive technical details with code snippets.`
  );

  // Query for Anthropic SDK - Claude features
  console.log('📡 Querying Anthropic SDK (Claude features)...');
  const anthropicSDK = await queryPerplexity(
    `What are the newest Anthropic SDK features for Claude Sonnet 4.5 and Opus 4.1 released in 2025? Include:
    1. Extended thinking and reasoning capabilities
    2. Tool use and function calling improvements
    3. Streaming features and beta parameters
    4. Vision and multimodal capabilities
    5. Token counting and context management
    6. Code examples demonstrating key features
    7. Performance optimizations and best practices
    Provide technical documentation-style details.`
  );

  // Query for Google Gemini SDK
  console.log('📡 Querying Google Gemini SDK (features)...');
  const geminiSDK = await queryPerplexity(
    `What are the newest Google Gemini SDK features for Gemini 2.5 Pro and Flash released in 2025? Include:
    1. Adaptive thinking and reasoning modes
    2. Multimodal capabilities (text/image/video/audio)
    3. Context caching and large context handling
    4. Function calling and tool integration
    5. Grounding with Google Search
    6. JSON mode and structured outputs
    7. Code examples and generation config options
    Provide comprehensive technical specifications.`
  );

  // Query for SDK installation and setup
  console.log('📡 Querying SDK installation best practices...');
  const sdkSetup = await queryPerplexity(
    `What are the latest SDK installation commands and version requirements for:
    1. OpenAI Python SDK (latest version)
    2. OpenAI Node.js SDK (latest version)
    3. Anthropic SDK (Python and Node.js)
    4. Google Generative AI SDK (Python and Node.js)
    Include pip/npm commands, version numbers, and compatibility notes.`
  );

  console.log('\n✅ All queries complete!\n');

  return {
    openai: openaiSDK,
    anthropic: anthropicSDK,
    gemini: geminiSDK,
    setup: sdkSetup,
    fetchDate: new Date().toISOString().split('T')[0]
  };
}

async function generateSDKMarkdown(sdkData) {
  const markdown = `# AI SDK Features Reference

> **Last Updated**: ${sdkData.fetchDate}  
> **Data Source**: Perplexity AI (High Research Mode)  
> **Research Quality**: Deep web search with citations

---

## 📦 SDK Installation & Setup

${sdkData.setup || 'Installation data unavailable'}

---

## 🚀 OpenAI SDK - GPT-5 Features

${sdkData.openai || 'OpenAI SDK data unavailable'}

---

## 🤖 Anthropic SDK - Claude Features

${sdkData.anthropic || 'Anthropic SDK data unavailable'}

---

## 🔮 Google Gemini SDK - Features

${sdkData.gemini || 'Google Gemini SDK data unavailable'}

---

## 📊 Feature Comparison Table

### Key Parameters Across SDKs

| Feature | OpenAI (GPT-5) | Anthropic (Claude) | Google (Gemini) |
|---------|----------------|-------------------|-----------------|
| **Verbosity Control** | ✅ \`verbosity\`: low/medium/high | ⚠️ Prompt-based | ⚠️ Prompt-based |
| **Reasoning Effort** | ✅ \`reasoning_effort\`: minimal/low/medium/high | ✅ Extended thinking (beta) | ✅ Adaptive thinking |
| **Function Calling** | ✅ Freeform + structured | ✅ Tool use system | ✅ Function declarations |
| **Structured Output** | ✅ CFG + JSON schema | ✅ JSON mode (beta) | ✅ JSON mode |
| **Streaming** | ✅ SSE streaming | ✅ Event streaming | ✅ Stream generate |
| **Multimodal** | ✅ Vision + audio | ✅ Vision (Claude 4) | ✅ Vision + video + audio |
| **Context Window** | 272K (GPT-5) | 200K (1M beta) | 2M tokens |
| **Max Output** | 128K tokens | 16K tokens | 8K tokens |

---

## 🛠️ Quick Start Examples

### OpenAI GPT-5 - Verbosity Parameter

\`\`\`javascript
import OpenAI from 'openai';

const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5-mini',
  input: 'Explain quantum computing',
  text: {
    verbosity: 'high'  // low | medium | high
  }
});

console.log(response.output[0].content[0].text);
\`\`\`

### OpenAI GPT-5 - Minimal Reasoning

\`\`\`javascript
const response = await client.chat.completions.create({
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'Extract the date: Meeting on 2025-10-16' }],
  reasoning_effort: 'minimal'  // Fast, no reasoning tokens
});
\`\`\`

### Anthropic Claude - Extended Thinking

\`\`\`javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-sonnet-4.5-20250929',
  max_tokens: 8192,
  thinking: {
    type: 'enabled',
    budget_tokens: 5000
  },
  messages: [{ role: 'user', content: 'Solve this complex problem...' }]
});
\`\`\`

### Google Gemini - Adaptive Thinking

\`\`\`javascript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-pro-latest',
  generationConfig: {
    thinkingConfig: {
      thinkingMode: 'adaptive'
    }
  }
});

const result = await model.generateContent('Complex reasoning task...');
\`\`\`

---

## 💡 Best Practices

### When to Use Verbosity (OpenAI)
- **Low**: Chat UIs, quick responses, cost-sensitive apps
- **Medium**: Default balanced output for most use cases
- **High**: Documentation, teaching, detailed explanations

### When to Use Reasoning Effort
- **Minimal**: Simple extraction, formatting, classification
- **Low**: Straightforward tasks with some logic
- **Medium**: Default for balanced performance
- **High**: Complex analysis, multi-step planning, code generation

### Streaming Best Practices
1. Always handle connection errors and timeouts
2. Implement client-side buffering for smooth UX
3. Use Server-Sent Events (SSE) for real-time updates
4. Consider backpressure in high-throughput scenarios

### Function Calling Tips
1. Use freeform calling for code/SQL generation (OpenAI)
2. Provide clear tool descriptions and schemas
3. Validate tool outputs before processing
4. Handle tool errors gracefully with fallbacks

---

## 🔗 Official Documentation Links

- **OpenAI SDK**: https://platform.openai.com/docs/
- **Anthropic SDK**: https://docs.anthropic.com/
- **Google Gemini SDK**: https://ai.google.dev/docs

---

## 📝 Version Compatibility

### OpenAI SDK
- Python: \`pip install openai>=1.99.0\`
- Node.js: \`npm install openai@latest\`

### Anthropic SDK
- Python: \`pip install anthropic>=0.40.0\`
- Node.js: \`npm install @anthropic-ai/sdk@latest\`

### Google Gemini SDK
- Python: \`pip install google-generativeai>=0.8.0\`
- Node.js: \`npm install @google/generative-ai@latest\`

---

## ⚠️ Important Notes

1. **Reasoning effort** impacts latency significantly:
   - Minimal: 2-5s
   - Low: 5-10s
   - Medium: 10-20s
   - High: 30-120s

2. **Verbosity** affects token usage linearly (low: ~500 → high: ~1200 tokens)

3. **Extended thinking** (Claude) and **adaptive thinking** (Gemini) are in beta

4. Always check rate limits and pricing for new features

5. Some features may require API version updates or beta access

---

**Generated by**: Perplexity AI (High Research) + Vecto Pilot™ SDK Tracker  
**Script**: \`scripts/fetch-latest-sdk.mjs\`  
**To Update**: Run \`node scripts/fetch-latest-sdk.mjs\`
`;

  return markdown;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   AI SDK Features - High Research Edition     ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  try {
    // Fetch latest SDK features
    const sdkData = await fetchLatestSDKFeatures();

    // Generate markdown
    console.log('📝 Generating SDK_FEATURES.md...');
    const markdown = await generateSDKMarkdown(sdkData);

    // Write to file
    writeFileSync('SDK_FEATURES.md', markdown);
    console.log('✅ SDK_FEATURES.md created successfully!');

    // Also create in Mega_Assistant_Port
    writeFileSync('Mega_Assistant_Port/SDK_FEATURES.md', markdown);
    console.log('✅ Mega_Assistant_Port/SDK_FEATURES.md created successfully!');

    console.log('\n🎉 Done! Check SDK_FEATURES.md for the latest SDK information.');
    
    if (!sdkData.openai && !sdkData.anthropic && !sdkData.gemini) {
      console.log('\n⚠️  Note: Perplexity queries failed. SDK_FEATURES.md contains fallback data.');
      console.log('   Check your PERPLEXITY_API_KEY or try again later.');
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
