// Perplexity API integration for real-time internet research
import fetch from 'node-fetch';

export class PerplexityResearch {
  constructor(apiKey = process.env.PERPLEXITY_API_KEY) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.perplexity.ai/chat/completions';
    // Updated model name for 2025 - check https://docs.perplexity.ai/guides/model-cards
    this.model = 'llama-3.1-sonar-small-128k-online'; // Current model as of 2025
  }

  async search(query, options = {}) {
    if (!this.apiKey) {
      throw new Error('PERPLEXITY_API_KEY not configured');
    }

    const {
      systemPrompt = 'Be precise and concise. Provide factual information with sources.',
      maxTokens = 500,
      temperature = 0.2,
      searchRecencyFilter = 'month',
      returnCitations = true
    } = options;

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          max_tokens: maxTokens,
          temperature,
          search_recency_filter: searchRecencyFilter,
          return_related_questions: true,
          stream: false
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Perplexity API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      
      return {
        answer: data.choices?.[0]?.message?.content || '',
        citations: data.citations || [],
        relatedQuestions: data.choices?.[0]?.message?.related_questions || [],
        model: data.model,
        usage: data.usage,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Perplexity research error:', error);
      throw error;
    }
  }

  async multiQuery(queries, options = {}) {
    const results = await Promise.allSettled(
      queries.map(q => this.search(q, options))
    );

    return results.map((result, idx) => ({
      query: queries[idx],
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));
  }

  async researchTopic(topic, depth = 'standard') {
    const queries = this.generateResearchQueries(topic, depth);
    const results = await this.multiQuery(queries);

    return {
      topic,
      depth,
      queries: results,
      summary: this.synthesizeResearch(results),
      allCitations: results.flatMap(r => r.data?.citations || []),
      timestamp: Date.now()
    };
  }

  generateResearchQueries(topic, depth) {
    const baseQuery = topic;
    
    if (depth === 'shallow') {
      return [baseQuery];
    }

    if (depth === 'standard') {
      return [
        baseQuery,
        `${topic} best practices 2025`,
        `${topic} common issues and solutions`
      ];
    }

    // Deep research
    return [
      baseQuery,
      `${topic} best practices and patterns 2025`,
      `${topic} performance optimization`,
      `${topic} common pitfalls and how to avoid them`,
      `${topic} latest updates and changes`
    ];
  }

  synthesizeResearch(results) {
    const successfulResults = results.filter(r => r.success);
    
    if (successfulResults.length === 0) {
      return 'No research results available';
    }

    const allAnswers = successfulResults.map(r => r.data.answer).join('\n\n');
    const keyPoints = this.extractKeyPoints(allAnswers);
    
    return {
      keyFindings: keyPoints,
      sourceCount: successfulResults.length,
      citationCount: successfulResults.reduce((acc, r) => acc + (r.data?.citations?.length || 0), 0)
    };
  }

  extractKeyPoints(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, 5).map(s => s.trim());
  }

  async researchFlightDisruptions(airportCode, airportName) {
    const query = `Current flight delays, ground stops, or disruptions at ${airportName} (${airportCode}) airport today. Summarize in 1-2 sentences for rideshare drivers.`;

    const result = await this.search(query, {
      systemPrompt: 'You are a travel disruption analyst helping rideshare drivers. Provide concise, actionable summaries about airport delays and ground stops. If no disruptions exist, say "normal operations".',
      maxTokens: 200,
      temperature: 0.2,
      searchRecencyFilter: 'day'
    });

    return {
      airport_code: airportCode,
      summary: result.answer,
      citations: result.citations,
      impact_level: this.assessImpactLevel(result.answer),
      timestamp: result.timestamp
    };
  }

  assessImpactLevel(summary) {
    const lowerSummary = summary.toLowerCase();
    
    if (lowerSummary.includes('ground stop') || lowerSummary.includes('closure') || lowerSummary.includes('major delays')) {
      return 'high';
    }
    if (lowerSummary.includes('delay') || lowerSummary.includes('slow')) {
      return 'medium';
    }
    if (lowerSummary.includes('normal') || lowerSummary.includes('no disruption')) {
      return 'none';
    }
    return 'low';
  }

  async getMultiAirportDisruptions(airports) {
    const results = await Promise.allSettled(
      airports.map(({ code, name }) => this.researchFlightDisruptions(code, name))
    );

    return results.map((result, idx) => ({
      airport: airports[idx],
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));
  }
}

export default PerplexityResearch;
