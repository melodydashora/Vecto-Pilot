
import fetch from 'node-fetch';

/**
 * Eidolon Enhanced SDK - Anthropic Extended Client
 * Uses raw HTTP to bypass SDK model validation for Claude Opus 4.1
 */

class AnthropicExtendedClient {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.baseURL = options.baseURL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    this.version = options.version || process.env.ANTHROPIC_VERSION || '2023-06-01';
    this.timeout = options.timeout || parseInt(process.env.ANTHROPIC_TIMEOUT_MS) || 60000;
  }

  get messages() {
    return {
      create: async (params) => {
        const { model, max_tokens, messages, system, ...otherParams } = params;
        
        // Use raw HTTP for Claude Sonnet 4.5 - bypasses SDK validation
        const response = await fetch(`${this.baseURL}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.version
          },
          body: JSON.stringify({
            model: model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
            max_tokens,
            messages,
            ...(system && { system }),
            ...otherParams
          }),
          timeout: this.timeout
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`Anthropic API error ${response.status}: ${JSON.stringify(errorData)}`);
        }

        const result = await response.json();
        return result;
      }
    };
  }
}

export function createAnthropicClient(apiKey, options = {}) {
  return new AnthropicExtendedClient(apiKey, {
    timeout: parseInt(process.env.ANTHROPIC_TIMEOUT_MS) || 60000,
    version: process.env.ANTHROPIC_VERSION || '2023-06-01',
    ...options
  });
}

export default AnthropicExtendedClient;
