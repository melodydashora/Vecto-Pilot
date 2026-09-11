// Coach-only Responses adapter. Other role transports remain unchanged.
// The server's canonical chat handler still owns context, validation and writes.

function inputPart(part) {
  if (typeof part.text === 'string') return { type: 'input_text', text: part.text };
  const file = part.inline_data;
  if (!file?.mime_type || !file?.data) throw new Error('Coach attachment is missing its content');
  const data = `data:${file.mime_type};base64,${file.data}`;
  if (file.mime_type.startsWith('image/')) return { type: 'input_image', image_url: data };
  return { type: 'input_file', filename: part.filename || 'attachment.pdf', file_data: data };
}

export function buildCoachResponseRequest(config, { system, messageHistory }) {
  if (!Array.isArray(messageHistory) || !messageHistory.length) throw new Error('Coach history is required');
  return {
    model: config.model,
    instructions: system,
    input: messageHistory.map(message => {
      const assistant = message.role === 'model' || message.role === 'assistant';
      return {
        role: assistant ? 'assistant' : 'user',
        content: message.parts.map(part => assistant
          ? { type: 'output_text', text: part.text || '' }
          : inputPart(part)),
      };
    }),
    reasoning: { effort: config.reasoningEffort || 'low' },
    max_output_tokens: config.maxTokens,
    tools: config.features?.includes('web_search') ? [{ type: 'web_search' }] : [],
    store: false,
    stream: true,
  };
}

export async function callCoachResponses(config, params, { fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) throw new Error('Coach provider is not configured: OPENAI_API_KEY is missing');
  const signal = params.signal
    ? AbortSignal.any([params.signal, AbortSignal.timeout(180_000)])
    : AbortSignal.timeout(180_000);
  return fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCoachResponseRequest(config, params)),
    signal,
  });
}

// Normalize semantic Responses events to the Coach contract. An interrupted or
// incomplete stream must never execute action tags from partial generated text.
export async function* readCoachResponse(response) {
  if (!response.ok) throw new Error(`Coach provider returned HTTP ${response.status}`);
  if (!response.body) throw new Error('Coach provider returned no response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const parse = line => {
    if (!line.startsWith('data:')) return null;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return null;
    return JSON.parse(raw);
  };
  function normalize(event) {
    if (!event) return null;
    if (event.type === 'response.output_text.delta') return { delta: event.delta };
    if (event.type === 'response.completed') {
      if (event.response?.status !== 'completed') throw new Error('Coach response did not complete');
      completed = true;
      const sources = new Map();
      for (const item of event.response.output || []) {
        for (const part of item.content || []) {
          for (const citation of part.annotations || []) {
            if (citation.type === 'url_citation' && /^https?:\/\//.test(citation.url || '')) {
              sources.set(citation.url, String(citation.title || 'Source').replace(/[\[\]\r\n]/g, ''));
            }
          }
        }
      }
      const links = [...sources].map(([url, title]) => `[${title}](${url.replace(/\)/g, '%29')})`);
      return { completed: true, model: event.response.model, ...(links.length && { delta: `\n\nSources: ${links.join(', ')}` }) };
    }
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) {
      throw new Error('Coach provider could not complete the response. No requested changes were applied.');
    }
    return null;
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      if (done && buffer) { lines.push(buffer); buffer = ''; }
      for (const line of lines) {
        const event = normalize(parse(line.replace(/\r$/, '')));
        if (event) yield event;
      }
      if (done) break;
    }
    if (!completed) throw new Error('Coach connection ended before confirmation. No requested changes were applied.');
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
