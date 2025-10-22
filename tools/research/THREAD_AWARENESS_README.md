# Thread-Aware Context System

## Overview
The Agent/Assistant/Eidolon system now includes comprehensive thread awareness and contextual memory tracking. This enables the system to maintain conversation context across sessions, track decisions, and automatically extract relevant information from conversations.

## Architecture

### Thread Context Manager
**Location**: `server/agent/thread-context.js`

The `ThreadContextManager` class provides:
- Conversation thread initialization and resumption
- Message tracking with role attribution (user, assistant, agent, system)
- Automatic entity extraction (model names, file paths, technical terms)
- Topic discovery from natural language
- Decision tracking with reasoning and impact
- Model interaction logging

### Enhanced Context Integration
**Location**: `server/agent/enhanced-context.js`

Enhanced to include:
- Thread-aware project context via `getEnhancedProjectContext({ threadId, includeThreadContext })`
- Access to current thread and recent thread history
- Thread awareness as a core capability

## API Endpoints

### Thread Management

**Initialize New Thread**:
```bash
POST /agent/thread/init
{
  "userId": "system",
  "sessionId": "optional-session-id",
  "parentThreadId": "optional-parent-thread-id"
}
```

**Get Thread Context**:
```bash
GET /agent/thread/{threadId}
```

Returns:
```json
{
  "ok": true,
  "thread": {
    "threadId": "uuid",
    "userId": "system",
    "sessionId": "uuid",
    "startedAt": "ISO-8601",
    "messageCount": 15,
    "messages": [...],
    "context": {
      "topics": ["Model Configuration", "Thread Awareness"],
      "entities": ["claude-sonnet-4-5-20250929", "gpt-5-pro", "server/agent/thread-context.js"],
      "modelInteractions": [{
        "provider": "anthropic",
        "timestamp": "ISO-8601",
        "role": "assistant"
      }],
      "keyDecisions": [...]
    },
    "messageSummary": {
      "total": 15,
      "byRole": { "user": 8, "assistant": 7 },
      "byProvider": { "anthropic": 5, "openai": 2 }
    }
  }
}
```

**Add Message to Thread**:
```bash
POST /agent/thread/{threadId}/message
{
  "role": "user|assistant|agent|system",
  "content": "Message content",
  "modelProvider": "anthropic|openai|google",
  "metadata": { "custom": "data" }
}
```

**Track Decision**:
```bash
POST /agent/thread/{threadId}/decision
{
  "decision": "Updated Claude model to Sonnet 4.5",
  "reasoning": "Latest model with superior performance",
  "impact": "high",
  "relatedTo": ["model-config", "performance"]
}
```

**Get Recent Threads**:
```bash
GET /agent/threads/recent?userId=system&limit=10
```

## Automatic Context Extraction

The thread system automatically extracts:

### Topics
- Capitalized phrases (2+ words)
- Technical terms and proper nouns
- Last 50 topics retained per thread

### Entities
- **Model Names**: `gpt-5-pro`, `claude-sonnet-4-5-20250929`, `gemini-2.5-pro-latest`
- **File Paths**: `server/agent/thread-context.js`, `config/settings.json`
- **Technical Terms**: Framework names, API endpoints, etc.

### Model Interactions
Tracks which AI providers were used in each message:
```javascript
{
  provider: "anthropic",
  timestamp: "2025-10-08T03:30:00Z",
  role: "assistant"
}
```

## Usage Examples

### Initialize Thread for User Interaction
```javascript
import { getThreadManager } from './server/agent/thread-context.js';

const manager = getThreadManager();
const threadId = await manager.initThread({ 
  userId: "user_123", 
  sessionId: "session_abc" 
});
```

### Add User Message
```javascript
await manager.addMessage({
  role: "user",
  content: "Update the Claude model to use Sonnet 4.5"
});
```

### Add Assistant Response
```javascript
await manager.addMessage({
  role: "assistant",
  content: "I've updated the .env file with claude-sonnet-4-5-20250929",
  modelProvider: "anthropic"
});
```

### Track Important Decision
```javascript
await manager.trackDecision({
  decision: "Switched from Router V2 to Triad single-path mode",
  reasoning: "User requires no fallbacks for consistent quality",
  impact: "high",
  relatedTo: ["architecture", "model-routing"]
});
```

### Get Full Thread Context
```javascript
const threadContext = await manager.getThreadContext(threadId);
console.log('Topics discussed:', threadContext.context.topics);
console.log('Files mentioned:', threadContext.context.entities);
console.log('Models used:', threadContext.messageSummary.byProvider);
```

## Integration with Enhanced Context

```javascript
import { getEnhancedProjectContext } from './server/agent/enhanced-context.js';

// Get project context with thread awareness
const context = await getEnhancedProjectContext({
  threadId: "thread-uuid",
  includeThreadContext: true
});

// Access thread data
console.log('Current thread:', context.threadContext.currentThread);
console.log('Recent threads:', context.threadContext.recentThreads);
```

## Database Schema

### Conversation Threads (`eidolon_memory`)
- **Scope**: `conversation_threads`
- **Key**: `threadId` (UUID)
- **Content**: Thread metadata with context
- **TTL**: 30 days

### Thread Messages (`assistant_memory`)
- **Scope**: `thread_messages`
- **Key**: `{threadId}:{messageId}`
- **Content**: Message with role, content, provider, metadata
- **TTL**: 30 days

## Benefits

1. **Contextual Continuity**: Resume conversations with full context
2. **Decision Tracking**: Audit trail of important choices
3. **Entity Recognition**: Automatic extraction of technical terms
4. **Model Attribution**: Track which AI provider handled each interaction
5. **Topic Discovery**: Understand conversation themes automatically
6. **Parent-Child Threads**: Support for complex conversation trees

## Performance Considerations

- Thread messages limited to last 200 per thread
- Topics/entities limited to last 50 per thread
- Auto-cleanup via TTL (30 days for conversations)
- Lightweight regex-based entity extraction (no ML overhead)

---

*This system enables the Agent/Assistant/Eidolon to maintain deep contextual awareness across all interactions, providing a foundation for more intelligent and context-aware responses.*
