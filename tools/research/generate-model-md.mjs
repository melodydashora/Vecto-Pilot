// Generate MODEL.md from research JSON with News APIs section
import fs from 'fs/promises';
import path from 'path';

async function generateModelMD() {
  // Load latest research JSON
  const researchDir = 'tools/research';
  const files = await fs.readdir(researchDir);
  const latestResearch = files
    .filter(f => f.startsWith('model-research-') && f.endsWith('.json'))
    .sort()
    .pop();

  if (!latestResearch) {
    throw new Error('No research JSON found');
  }

  const research = JSON.parse(
    await fs.readFile(path.join(researchDir, latestResearch), 'utf-8')
  );

  const date = new Date(research.generated_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const outputPath = 'MODEL.md';
  await fs.writeFile(outputPath, md);
  console.log(`✅ Generated: ${outputPath}`);
  console.log(`📊 Sections: LLMs (GPT-5, Claude, Gemini) + News APIs (Perplexity, SerpAPI, NewsAPI, Gemini)`);
  console.log(`📅 Research Date: ${date}`);
}

generateModelMD().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
