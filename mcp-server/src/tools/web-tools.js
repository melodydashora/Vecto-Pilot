/**
 * Web Tools (3 tools)
 *
 * web_fetch, web_search, api_call
 */

let repoRoot = process.cwd();

export const webTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // web_fetch - Fetch content from a URL
  // ─────────────────────────────────────────────────────────────────────────
  web_fetch: {
    category: 'web',
    description: 'Fetch content from a URL. Handles HTML, JSON, and text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', default: 'GET', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
        timeout: { type: 'number', default: 30000 },
        extract_text: { type: 'boolean', default: true, description: 'Extract text from HTML' }
      },
      required: ['url']
    },
    init(root) { repoRoot = root; },
    async execute({ url, method = 'GET', headers = {}, body, timeout = 30000, extract_text = true }) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'User-Agent': 'VectoPilot-MCP/1.0',
            ...headers
          },
          body: body ? body : undefined,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        let content;

        if (contentType.includes('application/json')) {
          content = await response.json();
        } else {
          content = await response.text();

          // Extract text from HTML if requested
          if (extract_text && contentType.includes('text/html')) {
            // Simple HTML text extraction
            content = content
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 50000); // Limit size
          }
        }

        return {
          url,
          status: response.status,
          status_text: response.statusText,
          content_type: contentType,
          content,
          headers: Object.fromEntries(response.headers.entries())
        };
      } catch (err) {
        clearTimeout(timeoutId);
        throw new Error(`Fetch failed: ${err.message}`);
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // web_search - Search the web (via DuckDuckGo)
  // ─────────────────────────────────────────────────────────────────────────
  web_search: {
    category: 'web',
    description: 'Search the web using DuckDuckGo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', default: 10 }
      },
      required: ['query']
    },
    init(root) { repoRoot = root; },
    async execute({ query, max_results = 10 }) {
      // Use DuckDuckGo HTML search (no API key needed)
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; VectoPilot-MCP/1.0)'
          }
        });

        const html = await response.text();

        // Parse results from HTML
        const results = [];
        const resultRegex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        const snippetRegex = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;

        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < max_results) {
          results.push({
            url: match[1],
            title: match[2].trim()
          });
        }

        // Add snippets
        let i = 0;
        while ((match = snippetRegex.exec(html)) !== null && i < results.length) {
          results[i].snippet = match[1].trim();
          i++;
        }

        return {
          query,
          results,
          count: results.length
        };
      } catch (err) {
        throw new Error(`Search failed: ${err.message}`);
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // api_call - Make API calls with common patterns
  // ─────────────────────────────────────────────────────────────────────────
  api_call: {
    category: 'web',
    description: 'Make API calls with common authentication patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'API endpoint URL' },
        method: { type: 'string', default: 'GET' },
        auth_type: {
          type: 'string',
          enum: ['none', 'bearer', 'basic', 'api_key'],
          default: 'none'
        },
        auth_value: { type: 'string', description: 'Auth token/key/credentials' },
        api_key_header: { type: 'string', default: 'X-API-Key', description: 'Header name for API key' },
        body: { type: 'object', description: 'Request body (will be JSON stringified)' },
        query_params: { type: 'object', description: 'URL query parameters' },
        timeout: { type: 'number', default: 30000 }
      },
      required: ['url']
    },
    init(root) { repoRoot = root; },
    async execute({ url, method = 'GET', auth_type = 'none', auth_value, api_key_header = 'X-API-Key', body, query_params, timeout = 30000 }) {
      // Build URL with query params
      const urlObj = new URL(url);
      if (query_params) {
        Object.entries(query_params).forEach(([key, value]) => {
          urlObj.searchParams.set(key, String(value));
        });
      }

      // Build headers
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'VectoPilot-MCP/1.0'
      };

      // Add authentication
      switch (auth_type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${auth_value}`;
          break;
        case 'basic':
          headers['Authorization'] = `Basic ${Buffer.from(auth_value).toString('base64')}`;
          break;
        case 'api_key':
          headers[api_key_header] = auth_value;
          break;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(urlObj.toString(), {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        let data;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          url: urlObj.toString(),
          method,
          status: response.status,
          ok: response.ok,
          data,
          headers: Object.fromEntries(response.headers.entries())
        };
      } catch (err) {
        clearTimeout(timeoutId);
        throw new Error(`API call failed: ${err.message}`);
      }
    }
  }
};
