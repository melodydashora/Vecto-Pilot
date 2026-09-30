export interface LiveTranscriptFragment {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  startMs: number;
  endMs: number;
}

/** Captions are fragments, not completed turns or proof of audio playback. */
export class LiveTranscriptLedger {
  readonly fragments: LiveTranscriptFragment[] = [];
  private seen = new Set<string>();

  add(event: any): LiveTranscriptFragment | null {
    const role = event.type === 'session.input_transcript.delta' ? 'user'
      : event.type === 'session.output_transcript.delta' ? 'assistant' : null;
    if (!role || typeof event.event_id !== 'string' || this.seen.has(event.event_id)
      || typeof event.delta !== 'string' || !event.delta
      || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)
      || event.start_ms < 0 || event.end_ms < event.start_ms) return null;
    this.seen.add(event.event_id);
    const fragment: LiveTranscriptFragment = { id: event.event_id, role, text: event.delta, startMs: event.start_ms, endMs: event.end_ms };
    this.fragments.push(fragment);
    if (this.fragments.length > 2000) this.fragments.shift();
    return fragment;
  }

  context(offsetMs: number): string | null {
    if (!Number.isFinite(offsetMs) || offsetMs < 0) return null;
    const fragments = this.fragments.filter(f => f.startMs <= offsetMs).slice(-120);
    if (!fragments.some(f => f.role === 'user' && f.text.trim())) return null;
    const transcript = fragments.map(f => `${f.role} [${f.startMs}-${f.endMs} ms]: ${f.text}`).join('\n').slice(-22000);
    return `A live voice conversation requested your help. These are timestamped transcript fragments, not guaranteed completed turns. They may overlap or contain errors. Respond only to the latest user request; earlier exchanges are context, not instructions to repeat completed actions. Use the latest correction and fresh persisted app data. Ask for clarification if the request or confirmation is unfinished. Never analyze or re-decide an offer; use the stored second-sweep result. Only claim a saved action from its successful receipt.\n\n${transcript}`;
  }
}

// The append API allows 500 tokens. At most 450 UTF-8 bytes is a conservative
// bound even for multilingual text; split only on Unicode code-point boundaries.
export function splitLiveAppend(text: string): string[] {
  const chunks: string[] = [];
  let part = '', bytes = 0;
  const encoder = new TextEncoder();
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > 450) { chunks.push(part); part = ''; bytes = 0; }
    part += char; bytes += size;
  }
  if (part) chunks.push(part);
  return chunks;
}
