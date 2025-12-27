#!/usr/bin/env node
// Parse flagship-models JSON into organized MODEL.md
// Auto-detects the latest research JSON file
// Run with: node tools/research/parse-flagship-json.mjs

import fs from 'fs/promises';
import path from 'path';

async function findLatestResearchFile() {
  const researchDir = 'tools/research';
  const files = await fs.readdir(researchDir);

  // Find all flagship-models JSON files
  const researchFiles = files
    .filter(f => f.startsWith('flagship-models-') && f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first

  if (researchFiles.length === 0) {
    throw new Error('No flagship-models-*.json files found in tools/research/');
  }

  return path.join(researchDir, researchFiles[0]);
}

// Strip <think>...</think> reasoning tokens from sonar-reasoning-pro output
function stripThinkingTokens(text) {
  if (!text) return text;
  // Remove <think>...</think> blocks (can be multiline)
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

async function parseToMarkdown() {
  try {
    // Auto-detect latest JSON file
    const jsonPath = await findLatestResearchFile();
    console.log(`📄 Using research file: ${jsonPath}`);

    const fileContent = await fs.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(fileContent);

    // Strip thinking tokens from all provider answers
    data.providers = data.providers.map(p => ({
      ...p,
      answer: stripThinkingTokens(p.answer)
    }));
    if (data.parameter_constraints) {
      data.parameter_constraints.answer = stripThinkingTokens(data.parameter_constraints.answer);
    }
    if (data.sdk_examples) {
      data.sdk_examples.answer = stripThinkingTokens(data.sdk_examples.answer);
    }

    const timestamp = new Date(data.generated_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Build markdown
    let md = `# AI Model Reference Guide

> **Last Updated:** ${timestamp}
> **Research Tool:** ${data.tool_used}
> **Total Citations:** ${data.total_citations || data.summary?.total_sources || 0}

This document contains up-to-date information about AI models and APIs used in this project.
Auto-generated from Perplexity web search research.

---

## Table of Contents

`;

    // Add provider links to TOC
    const aiProviders = data.providers.filter(p =>
      ['OpenAI', 'Anthropic', 'Google', 'Perplexity'].includes(p.provider)
    );
    const apiProviders = data.providers.filter(p =>
      ['TomTom', 'Google Maps'].includes(p.provider)
    );

    md += `### AI Models\n`;
    aiProviders.forEach((p, i) => {
      md += `${i + 1}. [${p.provider}](#${p.provider.toLowerCase().replace(/\s+/g, '-')})\n`;
    });

    md += `\n### External APIs\n`;
    apiProviders.forEach((p, i) => {
      md += `${aiProviders.length + i + 1}. [${p.provider}](#${p.provider.toLowerCase().replace(/\s+/g, '-')})\n`;
    });

    md += `\n### Reference\n`;
    let refNum = data.providers.length + 1;
    md += `${refNum++}. [Parameter Constraints](#parameter-constraints)\n`;
    if (data.sdk_examples) {
      md += `${refNum++}. [SDK Examples](#sdk-examples)\n`;
    }
    md += `${refNum}. [Update Workflow](#update-workflow)\n\n`;
    md += `---\n\n`;

    // Add Quick Reference table
    md += `## Quick Reference\n\n`;
    md += `| Provider | Flagship Model | Endpoint |\n`;
    md += `|----------|----------------|----------|\n`;
    md += `| OpenAI | gpt-5.2 | https://api.openai.com/v1/chat/completions |\n`;
    md += `| Anthropic | claude-opus-4-5-20251101 | https://api.anthropic.com/v1/messages |\n`;
    md += `| Google | gemini-3-pro-preview | https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent |\n`;
    md += `| Perplexity | sonar-pro | https://api.perplexity.ai/chat/completions |\n\n`;
    md += `---\n\n`;

    // Add AI Models section
    md += `# AI Models\n\n`;

    aiProviders.forEach(provider => {
      md += `## ${provider.provider}\n\n`;
      md += `**Research Date:** ${new Date(provider.timestamp).toLocaleString()}\n\n`;
      md += `${provider.answer}\n\n`;

      md += `---\n\n`;
    });

    // Add External APIs section
    md += `# External APIs\n\n`;

    apiProviders.forEach(provider => {
      md += `## ${provider.provider}\n\n`;
      md += `**Research Date:** ${new Date(provider.timestamp).toLocaleString()}\n\n`;
      md += `${provider.answer}\n\n`;
      md += `---\n\n`;
    });

    // Add parameter constraints section
    if (data.parameter_constraints) {
      md += `# Reference\n\n`;
      md += `## Parameter Constraints\n\n`;
      md += `> **IMPORTANT:** These are breaking changes that cause 400/401 errors if misconfigured.\n\n`;
      md += `${data.parameter_constraints.answer}\n\n`;
      md += `---\n\n`;
    }

    // Add SDK examples section
    if (data.sdk_examples) {
      md += `## SDK Examples\n\n`;
      md += `${data.sdk_examples.answer}\n\n`;
      md += `---\n\n`;
    }

    // Add update workflow
    md += `## Update Workflow\n\n`;
    md += `To refresh this documentation with new research:\n\n`;
    md += `\`\`\`bash\n`;
    md += `# Step 1: Run Perplexity search (requires PERPLEXITY_API_KEY)\n`;
    md += `node tools/research/perplexity-flagship-search.mjs\n\n`;
    md += `# Step 2: Parse JSON to MODEL.md\n`;
    md += `node tools/research/parse-flagship-json.mjs\n`;
    md += `\`\`\`\n\n`;

    md += `### What the scripts do:\n\n`;
    md += `1. **perplexity-flagship-search.mjs**\n`;
    md += `   - Uses Perplexity Sonar Pro with web search\n`;
    md += `   - Searches for flagship models from OpenAI, Anthropic, Google, Perplexity\n`;
    md += `   - Searches for API details from TomTom and Google Maps\n`;
    md += `   - Searches for parameter constraints and breaking changes\n`;
    md += `   - Searches for SDK and cURL examples\n`;
    md += `   - Outputs: \`tools/research/flagship-models-YYYY-MM-DD.json\`\n\n`;
    md += `2. **parse-flagship-json.mjs**\n`;
    md += `   - Auto-detects the latest JSON file\n`;
    md += `   - Parses research into organized MODEL.md\n`;
    md += `   - Outputs: \`MODEL.md\`\n\n`;

    md += `---\n\n`;
    md += `*Auto-generated on ${new Date().toISOString()}*\n`;

    // Write MODEL.md
    await fs.writeFile('MODEL.md', md);

    console.log('\n✅ MODEL.md generated successfully!');
    console.log(`📄 Location: MODEL.md`);
    console.log(`📊 AI Providers: ${aiProviders.length}`);
    console.log(`📊 API Providers: ${apiProviders.length}`);
    console.log(`📚 Total citations: ${data.total_citations || data.summary?.total_sources || 0}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

parseToMarkdown();
