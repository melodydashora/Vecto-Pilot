// server/lib/adapters/perplexity-adapter.js
// Perplexity Sonar API adapter for research and briefing

/**
 * Call Perplexity API for research/briefing tasks
 * @param {Object} params
 * @param {string} params.model - Perplexity model (e.g., 'sonar-pro')
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {number} params.maxTokens - Max tokens
 * @param {number} params.temperature - Temperature (0-2)
 * @returns {Promise<{ok: boolean, output: string, citations?: array}>}
 */
export async function callPerplexity({ 
  model, 
  system, 
  user, 
  maxTokens = 4000, 
  temperature = 0.2 
}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY environment variable not set');
  }

  console.log(`[perplexity-adapter] Calling ${model} with maxTokens=${maxTokens}, temp=${temperature}`);

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: maxTokens,
      temperature: temperature,
      top_p: 0.9,
      search_recency_filter: 'day',
      return_images: false,
      return_related_questions: false,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const citations = data.citations || [];

  if (!content) {
    throw new Error('No content returned from Perplexity API');
  }

  return {
    ok: true,
    output: content,
    citations: citations
  };
}
