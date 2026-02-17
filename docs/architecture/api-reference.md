### Chat & Voice

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/chat` | POST | `server/api/chat/chat.js` | AI Coach chat with SSE streaming + action parsing (Notes, Events (Add/Edit/Status), Memos, News, Zone Intel) & validation |
| `/api/chat/notes` | POST | `server/api/chat/chat.js` | Save a coach note about the user |
| `/api/chat/notes` | GET | `server/api/chat/chat.js` | Get user's coach notes |
| `/api/chat/notes/:noteId` | DELETE | `server/api/chat/chat.js` | Delete a coach note (soft delete) |
| `/api/chat/context/:snapshotId` | GET | `server/api/chat/chat.js` | Get full context for strategy coach |
| `/api/chat/conversations` | GET | `server/api/chat/chat.js` | List all conversations for user |
| `/api/chat/conversations/:conversationId` | GET | `server/api/chat/chat.js` | Get messages for a conversation |
| `/api/chat/conversations/:messageId/star` | POST | `server/api/chat/chat.js` | Star a message to mark as important |
| `/api/hooks/analyze-offer` | POST | `server/api/hooks/analyze-offer.js` | Real-time ride offer analysis (Text/Vision/Multipart) for Siri Shortcuts with voice response & analytics |