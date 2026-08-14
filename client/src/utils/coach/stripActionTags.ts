// client/src/utils/coach/stripActionTags.ts
// 2026-08-14: display hygiene for the chat thread. The server streams the
// model's raw text INCLUDING inline action tags ([ADD_EVENT: {...}] etc.) and
// only parses/strips them post-stream for persistence — so the raw tag JSON
// was visible in the on-screen transcript (Melody's 2026-08-14 test paste
// showed a full [ADD_EVENT: {...}] block). The server already EXECUTES the
// tags; this strips them from the displayed message once the stream ends.
//
// Deliberately display-only: cleanTextForTTS also strips markdown (too
// aggressive for on-screen text), and the server's parseActions stays the
// single execution authority.

const INLINE_TAG_RE = /\[([A-Z_]{3,}):\s*\{[\s\S]*?\}\]/g;

export function stripActionTags(text: string): string {
  return text
    .replace(INLINE_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
