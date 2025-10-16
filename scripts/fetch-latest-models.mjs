#!/usr/bin/env node

/**
 * Fetch Latest AI Models using Perplexity API
 * 
 * This script queries Perplexity to get the newest model versions from:
 * - Anthropic (Claude)
 * - OpenAI (GPT)
 * - Google (Gemini)
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

async function queryPerplexity(question) {
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
        max_tokens: 2000,
        return_citations: true,
        search_domain_filter: ['anthropic.com', 'openai.com', 'ai.google.dev']
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

async function fetchLatestModels() {
  console.log('🔍 Fetching latest AI models from Perplexity...\n');

  // Query for Anthropic Claude models
  console.log('📡 Querying Anthropic Claude models...');
  const claudeInfo = await queryPerplexity(
    'What are the latest Anthropic Claude model versions released in 2025? List Claude Sonnet 4.5 and Claude Opus 4.1 with exact model IDs including date suffixes (format: claude-sonnet-4.5-YYYYMMDD), release dates, context windows in tokens, and main features.'
  );

  // Query for OpenAI GPT models
  console.log('📡 Querying OpenAI GPT models...');
  const openaiInfo = await queryPerplexity(
    'What are the latest OpenAI GPT models released in 2025? Include GPT-5, GPT-4o, GPT-4-turbo with exact model IDs, release dates, context windows in tokens, reasoning_effort parameter support, and key features.'
  );

  // Query for Google Gemini models
  console.log('📡 Querying Google Gemini models...');
  const geminiInfo = await queryPerplexity(
    'What are the latest Google Gemini model versions released in 2025? Include Gemini 2.5 Pro and Gemini 2.0 Flash with exact model IDs, release dates, context windows in tokens, and main capabilities.'
  );

  console.log('\n✅ All queries complete!\n');

  return {
    claude: claudeInfo,
    openai: openaiInfo,
    gemini: geminiInfo,
    fetchDate: new Date().toISOString().split('T')[0]
  };
}

async function generateModelsMarkdown(modelsData) {
  const markdown = `# AI Models Reference

> **Last Updated**: ${modelsData.fetchDate}  
> **Data Source**: Perplexity AI (Real-time web search)

---

## 🤖 Anthropic Claude Models

${modelsData.claude || 'Data unavailable - API query failed'}

---

## 🧠 OpenAI GPT Models

${modelsData.openai || 'Data unavailable - API query failed'}

---

## 🔮 Google Gemini Models

${modelsData.gemini || 'Data unavailable - API query failed'}

---

## 📋 Quick Reference Table

### Model Comparison

| Provider | Model | Model ID | Context Window | Key Features |
|----------|-------|----------|----------------|--------------|
| Anthropic | Claude Sonnet 4.5 | \`claude-sonnet-4.5-20250929\` | 200K input / 8K output | Fast, accurate, cost-effective |
| Anthropic | Claude Opus 4.1 | \`claude-opus-4-1-20250805\` | 200K input / 16K output | Deep reasoning, complex tasks |
| OpenAI | GPT-5 Pro | \`gpt-5\` | 272K input / 128K output | Extended reasoning, high intelligence |
| OpenAI | GPT-4o | \`gpt-4o\` | 128K tokens | Multimodal, fast |
| Google | Gemini 2.5 Pro | \`gemini-2.5-pro-latest\` | 2M tokens | Massive context, multimodal |
| Google | Gemini 2.0 Flash | \`gemini-2.0-flash\` | 1M tokens | Fast, efficient |

---

## 🔄 Model Selection Guide

### Use Claude Sonnet 4.5 when:
- You need fast, accurate responses
- Cost efficiency is important
- Context window up to 200K is sufficient

### Use Claude Opus 4.1 when:
- Complex task delegation required
- Deep reasoning needed
- Extended output (16K tokens) required

### Use GPT-5 Pro when:
- Extended reasoning is critical
- Need massive output tokens (128K)
- Working with complex analysis

### Use Gemini 2.5 Pro when:
- Extremely large context needed (2M tokens)
- Multimodal capabilities required
- Document analysis at scale

---

## 📝 Configuration

### Environment Variables

\`\`\`bash
# Anthropic Claude
CLAUDE_MODEL=claude-sonnet-4.5-20250929
CLAUDE_OPUS_MODEL=claude-opus-4-1-20250805
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI GPT
OPENAI_MODEL=gpt-5
OPENAI_API_KEY=sk-...

# Google Gemini
GEMINI_MODEL=gemini-2.5-pro-latest
GOOGLE_API_KEY=...
\`\`\`

### Usage Examples

#### Claude Sonnet 4.5
\`\`\`javascript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4.5-20250929',
  max_tokens: 8192,
  messages: [{ role: 'user', content: 'Hello!' }]
});
\`\`\`

#### Claude Opus 4.1
\`\`\`javascript
const response = await anthropic.messages.create({
  model: 'claude-opus-4-1-20250805',
  max_tokens: 16384,
  messages: [{ role: 'user', content: 'Complex task...' }]
});
\`\`\`

#### GPT-5 Pro
\`\`\`javascript
const response = await openai.chat.completions.create({
  model: 'gpt-5',
  max_completion_tokens: 32000,
  reasoning_effort: 'high',
  messages: [{ role: 'user', content: 'Analyze...' }]
});
\`\`\`

#### Gemini 2.5 Pro
\`\`\`javascript
const result = await model.generateContent({
  contents: [{ role: 'user', parts: [{ text: 'Question...' }] }],
  generationConfig: { maxOutputTokens: 8192 }
});
\`\`\`

---

## 🔗 Official Documentation

- **Anthropic Claude**: https://docs.anthropic.com/
- **OpenAI GPT**: https://platform.openai.com/docs/
- **Google Gemini**: https://ai.google.dev/docs

---

## ⚠️ Notes

1. Model IDs with date suffixes (YYYYMMDD) indicate specific versions
2. Always use the latest version for best performance
3. Context windows and pricing may change - check official docs
4. Some models may be in preview/beta status

---

**Generated by**: Perplexity AI + Vecto Pilot™ Model Tracker  
**Script**: \`scripts/fetch-latest-models.mjs\`  
**To Update**: Run \`node scripts/fetch-latest-models.mjs\`
`;

  return markdown;
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   AI Models Fetcher - Perplexity Edition   ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    // Fetch latest models
    const modelsData = await fetchLatestModels();

    // Generate markdown
    console.log('📝 Generating MODELS.md...');
    const markdown = await generateModelsMarkdown(modelsData);

    // Write to file
    writeFileSync('MODELS.md', markdown);
    console.log('✅ MODELS.md created successfully!');

    // Also create in Mega_Assistant_Port
    writeFileSync('Mega_Assistant_Port/MODELS.md', markdown);
    console.log('✅ Mega_Assistant_Port/MODELS.md created successfully!');

    console.log('\n🎉 Done! Check MODELS.md for the latest AI model information.');
    
    if (!modelsData.claude && !modelsData.openai && !modelsData.gemini) {
      console.log('\n⚠️  Note: Perplexity queries failed. MODELS.md contains fallback data.');
      console.log('   Check your PERPLEXITY_API_KEY or try again later.');
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
