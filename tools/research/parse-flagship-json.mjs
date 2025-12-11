
#!/usr/bin/env node
// Parse flagship-models JSON into organized MODEL.md
import fs from 'fs/promises';
import path from 'path';

async function parseToMarkdown() {
  try {
    // Load the JSON
    const jsonPath = 'tools/research/flagship-models-2025-12-11.json';
    const fileContent = await fs.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(fileContent);

    const timestamp = new Date(data.generated_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Build markdown
    let md = `# AI Model Reference Guide

> **Last Updated:** ${timestamp}
> **Research Tool:** ${data.tool_used}
> **Total Citations:** ${data.summary.total_sources}

---

## Table of Contents

`;

    // Add provider links to TOC
    data.providers.forEach(p => {
      md += `1. [${p.provider}](#${p.provider.toLowerCase().replace(/\s+/g, '-')})\n`;
    });

    md += `${data.providers.length + 1}. [Parameter Constraints](#parameter-constraints)\n`;
    md += `${data.providers.length + 2}. [Citations](#citations)\n\n`;
    md += `---\n\n`;

    // Add each provider's section
    data.providers.forEach(provider => {
      md += `## ${provider.provider}\n\n`;
      md += `**Research Date:** ${new Date(provider.timestamp).toLocaleString()}\n\n`;
      md += `${provider.answer}\n\n`;

      if (provider.citations && provider.citations.length > 0) {
        md += `**Sources (${provider.citations.length}):**\n`;
        provider.citations.forEach((url, i) => {
          md += `${i + 1}. ${url}\n`;
        });
        md += `\n`;
      }

      md += `---\n\n`;
    });

    // Add parameter constraints section
    if (data.parameter_constraints) {
      md += `## Parameter Constraints\n\n`;
      md += `**Last Updated:** ${new Date(data.parameter_constraints.timestamp).toLocaleString()}\n\n`;
      md += `${data.parameter_constraints.answer}\n\n`;

      if (data.parameter_constraints.citations && data.parameter_constraints.citations.length > 0) {
        md += `**Sources (${data.parameter_constraints.citations.length}):**\n`;
        data.parameter_constraints.citations.forEach((url, i) => {
          md += `${i + 1}. ${url}\n`;
        });
        md += `\n`;
      }

      md += `---\n\n`;
    }

    // Add citations section
    md += `## Citations\n\n`;
    md += `**Total Sources:** ${data.total_citations}\n\n`;

    data.providers.forEach(provider => {
      if (provider.citations && provider.citations.length > 0) {
        md += `### ${provider.provider}\n`;
        provider.citations.forEach((url, i) => {
          md += `${i + 1}. ${url}\n`;
        });
        md += `\n`;
      }
    });

    if (data.parameter_constraints && data.parameter_constraints.citations) {
      md += `### Parameter Constraints\n`;
      data.parameter_constraints.citations.forEach((url, i) => {
        md += `${i + 1}. ${url}\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
    md += `## Update Workflow\n\n`;
    md += `To refresh this documentation with new research:\n\n`;
    md += `\`\`\`bash\n`;
    md += `node tools/research/perplexity-flagship-search.mjs\n`;
    md += `node tools/research/parse-flagship-json.mjs\n`;
    md += `\`\`\`\n\n`;
    md += `---\n\n`;
    md += `*Auto-generated on ${new Date().toISOString()}*\n`;

    // Write MODEL.md
    await fs.writeFile('MODEL.md', md);

    console.log('\n✅ MODEL.md generated successfully!');
    console.log(`📄 Location: MODEL.md`);
    console.log(`📊 Providers: ${data.providers?.length || 0}`);
    console.log(`📚 Total citations: ${data.total_citations || 0}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

parseToMarkdown();
