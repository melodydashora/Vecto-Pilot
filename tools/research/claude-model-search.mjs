
// Search for newest Claude models using Gemini (no Perplexity required)
import 'dotenv/config';

async function searchClaudeModels() {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY or GOOGLE_API_KEY not set in environment');
    process.exit(1);
  }

  console.log('🔍 Searching for newest Claude models from Anthropic...\n');

  const query = `What are the newest Claude AI models from Anthropic as of December 2025? 
  
  Please provide:
  1. Latest model names and their exact API identifiers
  2. Release dates
  3. Key features and improvements
  4. Context window sizes
  5. Pricing information if available
  6. Any deprecated models that have been replaced
  
  Focus on production-ready models suitable for API integration.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: query }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';

    if (!result) {
      throw new Error('Empty response from Gemini');
    }

    console.log('📊 Claude Model Research Results:\n');
    console.log(result);
    console.log('\n✅ Search complete!');

    // Save to file
    const timestamp = new Date().toISOString().split('T')[0];
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const outputPath = path.join(process.cwd(), 'tools', 'research', `claude-models-${timestamp}.txt`);
    await fs.writeFile(outputPath, result);
    
    console.log(`\n💾 Results saved to: ${outputPath}`);

  } catch (error) {
    console.error('❌ Search failed:', error.message);
    process.exit(1);
  }
}

searchClaudeModels();
