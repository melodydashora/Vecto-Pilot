# Subagents

Specialized AI subagents for specific tasks.

## Files

| File | Purpose |
|------|---------|
| `event-verifier.js` | Verifies events discovered by AI |

## Event Verifier

Validates events found during briefing generation:
- Confirms event exists via web search
- Verifies date/time accuracy
- Checks venue/location details
- Returns confidence score

### Usage

```javascript
import { verifyEvent } from './subagents/event-verifier.js';

const result = await verifyEvent({
  title: 'Taylor Swift Concert',
  venue: 'AT&T Stadium',
  date: '2025-01-15',
  city: 'Arlington, TX'
});
// { verified: true, confidence: 0.95, source: 'ticketmaster.com' }
```

## Adding New Subagents

Subagents should:
1. Have a single, focused responsibility
2. Return structured results with confidence scores
3. Handle failures gracefully
4. Log operations for debugging

## See Also

- [server/lib/ai/](../ai/) - AI adapters and providers
- [server/lib/events/](../events/) - Event discovery system
