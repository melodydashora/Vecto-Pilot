# Mega Assistant Port - System Architecture

## Overview

The Mega Assistant Port is a three-server architecture providing enterprise-grade AI assistance with enhanced memory, agent override capabilities, and production-ready fallback chains.

## Server Architecture

### 1. Gateway Server (Port 5000)

**Purpose**: Public-facing proxy with security, authentication, and rate limiting

**Responsibilities**:
- Request proxying to Eidolon SDK and Agent servers
- Token-based authentication (GW_KEY)
- Rate limiting (100 requests per 15 minutes)
- CORS and security headers (Helmet)
- Health checks and diagnostics

**Key Routes**:
- `/eidolon/*` → Proxies to Eidolon SDK Server
- `/agent/*` → Proxies to Agent Server
- `/api/diagnostics` → System health monitoring

### 2. Eidolon SDK Server (Port 3101)

**Purpose**: Main AI assistant with enhanced memory and context awareness

**Responsibilities**:
- AI conversation handling (Claude, GPT-5, Gemini)
- PostgreSQL-backed memory management
- Thread-aware context retrieval
- User preference persistence
- Policy enforcement

**Key Features**:
- **Enhanced Memory**: 730-day retention
- **Thread Awareness**: Cross-session conversation tracking
- **Context Enhancement**: Smart context retrieval
- **Multiple Providers**: Claude/GPT-5/Gemini support

### 3. Agent Server (Port 43717)

**Purpose**: Workspace intelligence with LLM-powered operations (Atlas)

**Responsibilities**:
- File system operations (read, write, search)
- Shell command execution
- SQL query operations
- Fallback chain management

**Fallback Chain**:
1. **Claude Sonnet 4.5** (Primary)
2. **GPT-5 Pro** (Fallback 1)
3. **Gemini 2.5 Pro** (Fallback 2)

## Data Flow

```
User Request
    │
    ▼
┌─────────────────────┐
│  Gateway Server     │
│  - Auth Check       │
│  - Rate Limit       │
└────────┬────────────┘
         │
    ┌────┴─────┐
    ▼          ▼
┌─────────┐  ┌──────────────┐
│ Eidolon │  │ Agent Server │
│  SDK    │  │   (Atlas)    │
└────┬────┘  └──────┬───────┘
     │              │
     └──────┬───────┘
            ▼
    ┌──────────────┐
    │  PostgreSQL  │
    │   Database   │
    └──────────────┘
```

## Memory System

### Database Schema

**assistant_conversations**:
- Stores all conversation messages
- Thread-aware grouping
- 730-day retention

**assistant_user_preferences**:
- User settings and preferences
- JSON-based flexible storage

**assistant_sessions**:
- Session state tracking
- Last activity monitoring

### Memory Operations

1. **Storage**: Every message auto-saved to PostgreSQL
2. **Retrieval**: Context-aware fetching (recent + relevant)
3. **Compaction**: Automatic pruning based on retention policy

## Security Model

### Token-Based Authentication

1. **GW_KEY**: Gateway access (all requests)
2. **EIDOLON_TOKEN**: Eidolon SDK access
3. **AGENT_TOKEN**: Agent server access

### Request Flow

```
Request → Gateway (GW_KEY) → Eidolon/Agent (TOKEN) → Response
```

### Rate Limiting

- **Window**: 15 minutes (900000ms)
- **Max Requests**: 100
- **Per**: IP address

## Fallback System

### Agent Override Fallback Chain

```
Request
  │
  ▼
Claude Sonnet 4.5 ──[fails]──► GPT-5 Pro ──[fails]──► Gemini 2.5 Pro
  │                               │                       │
  ▼                               ▼                       ▼
Success                         Success                 Success
```

### Provider Selection Logic

1. Try primary provider (Claude)
2. On error, try fallback 1 (GPT-5)
3. On error, try fallback 2 (Gemini)
4. If all fail, return error to client

## Configuration

### Environment Variables

**Security**:
- `AGENT_TOKEN`, `EIDOLON_TOKEN`, `GW_KEY`

**AI Providers**:
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`

**Database**:
- `DATABASE_URL`

**Server Ports**:
- `GATEWAY_PORT`, `EIDOLON_SDK_PORT`, `AGENT_SERVER_PORT`

### Policy Configuration

`config/assistant-policy.json` controls:
- Memory settings (retention, thread awareness)
- Agent override settings (allowed operations, fallback chain)
- Rate limiting parameters

## Deployment Considerations

### Development

```bash
npm run dev  # Starts all servers in parallel
```

### Production

```bash
NODE_ENV=production npm start
```

**Recommended Setup**:
- PostgreSQL with connection pooling
- Process manager (PM2, systemd)
- Reverse proxy (nginx)
- HTTPS termination
- Environment-based configuration

### Scaling

**Horizontal Scaling**:
- Run multiple Gateway instances behind load balancer
- Share PostgreSQL instance
- Coordinate rate limiting via Redis (future enhancement)

**Vertical Scaling**:
- Increase server resources
- Optimize PostgreSQL queries
- Cache frequently accessed memory

## Monitoring

### Diagnostics Endpoint

`GET /api/diagnostics` returns:
- Server status
- Database connectivity
- Memory usage
- Request counts
- Error rates

### Logging

- Console logging (development)
- File logging (production)
- Structured logs with request IDs
- Error tracking and reporting

## Performance

### Typical Response Times

- **Eidolon Chat**: 1-5 seconds
- **Agent Operations**: 2-10 seconds
- **Memory Retrieval**: <100ms
- **Diagnostics**: <50ms

### Optimization Strategies

1. **Database Indexing**: On thread_id, user_id, created_at
2. **Connection Pooling**: Reuse PostgreSQL connections
3. **Caching**: Frequently accessed preferences
4. **Batch Operations**: Group memory saves

## Error Handling

### Error Types

1. **Authentication Errors**: 401 Unauthorized
2. **Rate Limit Errors**: 429 Too Many Requests
3. **Provider Errors**: Fallback chain activation
4. **Database Errors**: Logged, returned as 500

### Recovery Mechanisms

- **Fallback Chain**: Auto-switch providers
- **Retry Logic**: Configurable retry attempts
- **Circuit Breaker**: Prevent cascade failures
- **Graceful Degradation**: Limited functionality on errors
