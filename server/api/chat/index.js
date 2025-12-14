// server/api/chat/index.js - Barrel exports for chat routes
// Chat endpoints: AI Coach, voice, TTS

export { default as chatRouter } from './chat.js';
export { default as chatContextRouter } from './chat-context.js';
export { default as realtimeRouter } from './realtime.js';
export { default as ttsRouter } from './tts.js';

// Route summary:
// POST /api/chat/:snapshotId/message - AI Coach with SSE streaming
// GET  /coach/context/:snapshotId - Read-only chat context
// POST /api/realtime/token - OpenAI Realtime voice token (AUTH REQUIRED)
// POST /api/tts - Text-to-speech (AUTH REQUIRED)
