# Removals — 2026-08-11 — Coach voice switcher (Phase 1, server)

Convention: removed/relocated code comments are preserved here with reasoning
(app_rules: comment-hygiene).

## server/api/chat/realtime.js — model-class doctrine comment relocated to registry

Removed from realtime.js (lines 22–27):

```js
// COACH_VOICE role: real-time voice chat with snapshot context.
// 2026-04-25: 'gpt-realtime' is the realtime-class default. The Realtime API
// (/v1/realtime/client_secrets) only accepts realtime-class models; chat
// models like gpt-5.x will fail. Text/reasoning paths use
// OPENAI_MODEL=gpt-5.5-2026-04-23, which is intentionally distinct.
const VOICE_MODEL = process.env.VOICE_MODEL || 'gpt-realtime';
```

**Why:** the raw `process.env.VOICE_MODEL` read bypassed the model registry —
a doctrine violation (model-agnostic-roles: models resolve by ROLE via the
registry). The comment's substance (realtime-class vs chat-class models) was
still true and now lives on the `COACH_VOICE_REALTIME` role entry in
`server/lib/ai/model-registry.js`, enforced mechanically by the new
`requiresLive` guard rather than by a comment asking readers to remember it.
The env var `VOICE_MODEL` keeps working — it is the role's `envKey`. The
speculative "COACH_VOICE role" name the old comment wished for became two real
roles: `COACH_VOICE_REALTIME` (OpenAI arm) and `COACH_VOICE_LIVE` (Gemini arm).

## client/src/lib/voice/pcm.ts — inline Blob-URL worklet replaced with static file

Removed (committed in 2abdef36, replaced same day after Melody's phone test):

```ts
/** Inline AudioWorklet module (Blob URL avoids a Vite asset pipeline entry). */
const CAPTURE_WORKLET = `...registerProcessor('pcm-capture', PcmCaptureProcessor);`;
const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
await this.ctx.audioWorklet.addModule(workletUrl);
```

**Why:** worklet modules are governed by CSP `script-src`; the Blob URL needed
`script-src blob:` and failed on-device ("Unable to load a worklet's module").
Serving `client/public/pcm-capture.worklet.js` from `'self'` fixes it while
keeping the CSP tight — preferable to widening script-src.
