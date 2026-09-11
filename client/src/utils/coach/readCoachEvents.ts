import type { DonePayloadMeta } from './actionsResult';

export interface CoachStreamEvent extends DonePayloadMeta { delta?: string }

// Wait for complete lines. A network chunk may end just after valid JSON but
// before its newline; parsing that tail early would replay it on the next chunk.
export async function* readCoachEvents(body: ReadableStream<Uint8Array> | null): AsyncGenerator<CoachStreamEvent> {
  if (!body) throw new Error('Coach returned no response stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      if (done && buffer) { lines.push(buffer); buffer = ''; }
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw && raw !== '[DONE]') yield JSON.parse(raw);
      }
      if (done) break;
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
