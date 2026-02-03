# AI Coach Enhancements - TODO

**Created:** 2025-12-29
**Status:** PENDING
**Priority:** High

## Requirements

### 1. Notes Field Updates
- AI Coach should be able to update a `notes` field for users
- Consider adding to `driver_profiles` table or creating separate `coach_notes` table
- Notes should persist across sessions

### 2. Database Visibility
- AI Coach needs visibility into all tables and fields
- Create a schema introspection endpoint or provide schema context to the coach
- Tables to expose:
  - `users` / `driver_profiles` / `driver_vehicles`
  - `market_intelligence`
  - `snapshots` / `strategies`
  - `ranking_candidates` / `venue_events`
  - Any other relevant tables

### 3. Error Checking
- Implement error validation in coach responses
- Check for:
  - Invalid market slugs
  - Missing required fields
  - Data consistency issues
  - API response validation

### 4. Documentation
- Document all coach capabilities
- Create coach context documentation
- Add to `docs/architecture/ai-coach.md`

## Implementation Notes

The AI Coach currently uses:
- `/api/chat/coach` for text conversations
- `/api/intelligence/coach/:market` for market context
- Memory system for conversation history

Consider adding:
- `/api/coach/notes` - CRUD for coach notes
- `/api/coach/schema` - Database schema visibility
- `/api/coach/validate` - Error checking endpoint

## Related Files
- `server/api/chat/chat.js` - Chat routes
- `server/lib/ai/providers/` - AI providers
- `client/src/components/CoachChat.tsx` - Chat UI
