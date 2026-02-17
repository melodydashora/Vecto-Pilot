Based on the code changes in `server/api/chat/chat.js`, specifically the updated `parseActions` function which now supports `ADD_EVENT`, `UPDATE_EVENT`, and `COACH_MEMO` actions (dated 2026-02-17), the documentation for the `/api/chat` endpoint should be updated to reflect these expanded capabilities.

### Chat & Voice

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/chat` | POST | `server/api/chat/chat.js` | AI Coach chat with SSE streaming + action parsing (Notes, Events, Memos) & validation |
| `/api/chat/notes` | POST | `server/api/chat/chat.js` | Save a coach note about the user |
| `/api/chat/notes` | GET | `server/api/chat/chat.js` | Get user's coach notes |
| `/api/chat/notes/:noteId` | DELETE | `server/api/chat/chat.js` | Delete a coach note (soft delete) |
| `/api/chat/context/:snapshotId` | GET | `server/api/chat/chat.js` | Get full context for strategy coach |
| `/api/chat/conversations` | GET | `server/api/chat/chat.js` | List all conversations for user |
| `/api/chat/conversations/:conversationId` | GET | `server/api/chat/chat.js` | Get messages for a conversation |
| `/api/chat/conversations/:messageId/star` | POST | `server/api/chat/chat.js` | Star a message to mark as important |