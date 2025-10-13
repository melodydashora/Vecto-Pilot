# 🚀 Mega Assistant Port

**Enterprise-Grade AI Assistant System with Enhanced Memory, Agent Override, and Multi-Provider Fallback**

A comprehensive, portable package containing the complete Eidolon SDK, Agent Override (Atlas), and enhanced assistant capabilities with PostgreSQL-backed persistent memory, thread-aware context, and production-ready fallback chains.

---

## 📋 Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [API Endpoints](#api-endpoints)
- [Memory System](#memory-system)
- [Agent Override (Atlas)](#agent-override-atlas)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The Mega Assistant Port is a complete AI assistant infrastructure that can be deployed to any Node.js project. It includes:

- **Eidolon SDK Server**: Main AI assistant with enhanced memory and context awareness
- **Agent Server (Atlas)**: Workspace intelligence with fallback chain (Claude → GPT-5 → Gemini)
- **Gateway Server**: Public-facing proxy with authentication and rate limiting
- **PostgreSQL Memory**: 730-day retention with conversation history, preferences, and project state
- **Thread-Aware Context**: Cross-session memory and intelligent context retrieval

### What Makes This Different?

Unlike standard AI assistants (like Replit's default "Vera"), this system provides:

✅ **Enhanced Memory**: Persistent PostgreSQL-backed memory (not session-only)  
✅ **Thread Awareness**: Remembers conversations across sessions  
✅ **Agent Override**: Full workspace access (file ops, shell, SQL)  
✅ **Fallback Resilience**: Automatic provider switching on failures  
✅ **Production-Ready**: Token auth, rate limiting, diagnostics  

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GATEWAY SERVER                       │
│                    (Port 5000)                          │
│  • Public-facing proxy                                  │
│  • Token authentication (GW_KEY)                        │
│  • Rate limiting (100 req/15min)                        │
│  • CORS & Helmet security                               │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
┌─────────────────────┐  ┌─────────────────────────────────┐
│  EIDOLON SDK SERVER │  │     AGENT SERVER (ATLAS)        │
│    (Port 3101)      │  │       (Port 43717)              │
│                     │  │                                 │
│ • Main AI assistant │  │ • Workspace intelligence        │
│ • Enhanced memory   │  │ • File system operations        │
│ • Context awareness │  │ • Shell command execution       │
│ • Policy enforcement│  │ • SQL query execution           │
│ • Thread tracking   │  │ • Fallback chain:               │
│                     │  │   1. Claude Sonnet 4.5          │
│ Token: EIDOLON_TOKEN│  │   2. GPT-5 Pro                  │
│                     │  │   3. Gemini 2.5 Pro             │
│                     │  │                                 │
│                     │  │ Token: AGENT_TOKEN              │
└──────────┬──────────┘  └────────────┬────────────────────┘
           │                          │
           └────────┬─────────────────┘
                    ▼
           ┌─────────────────┐
           │   POSTGRESQL    │
           │   DATABASE      │
           │                 │
           │ • Memory store  │
           │ • Conversations │
           │ • User prefs    │
           │ • Project state │
           │ • 730-day TTL   │
           └─────────────────┘
```

---

## ✨ Features

### Core Capabilities

- **Multi-Provider AI**: Claude, GPT-5, Gemini support with automatic fallback
- **Enhanced Memory System**: PostgreSQL-backed with 2-year retention
- **Thread-Aware Context**: Remembers conversations across sessions
- **Agent Override (Atlas)**: Full workspace access with LLM-powered operations
- **Authentication**: Token-based security for all endpoints
- **Rate Limiting**: Configurable request throttling
- **Diagnostics**: Real-time system health monitoring
- **Policy Enforcement**: Configurable assistant behavior and constraints

### Memory Features

- **Conversation History**: Full message tracking with thread awareness
- **User Preferences**: Persistent settings and customizations
- **Project State**: Track project context and evolution
- **Session Management**: Cross-session memory continuity
- **Automatic Compaction**: Prune old entries based on retention policy

### Agent Override Features

- **File Operations**: Read, write, edit files with AI assistance
- **Shell Commands**: Execute system commands safely
- **SQL Queries**: Database operations and debugging
- **Fallback Chain**: Claude → GPT-5 → Gemini for operational continuity
- **Context Enhancement**: Workspace intelligence and smart suggestions

---

## 📦 Prerequisites

- **Node.js**: v20.x or higher
- **PostgreSQL**: v14 or higher
- **API Keys**:
  - Anthropic API key (Claude)
  - OpenAI API key (GPT-5)
  - Google AI API key (Gemini)

---

## 🚀 Installation

### 1. Copy Files to Your Project

```bash
# Copy the entire Mega_Assistant_Port directory to your project root
cp -r Mega_Assistant_Port /path/to/your/project/
cd /path/to/your/project/Mega_Assistant_Port
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Database

```bash
# Create database
createdb your_assistant_db

# Run migrations
npm run db:push
```

### 4. Configure Environment

```bash
# Copy template and edit with your values
cp config/.env.template .env
nano .env
```

### 5. Generate Security Tokens

```bash
# Generate tokens for AGENT_TOKEN, EIDOLON_TOKEN, GW_KEY
openssl rand -hex 32
```

---

## ⚙️ Configuration

### Environment Variables

Edit `.env` with your configuration:

```bash
# Security Tokens (REQUIRED)
AGENT_TOKEN=<64-char-hex-token>
EIDOLON_TOKEN=<64-char-hex-token>
GW_KEY=<64-char-hex-token>

# AI Provider Keys (REQUIRED)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Database (REQUIRED)
DATABASE_URL=postgresql://user:pass@localhost:5432/assistant_db

# Server Ports (Optional - defaults shown)
EIDOLON_SDK_PORT=3101
AGENT_SERVER_PORT=43717
GATEWAY_PORT=5000

# AI Models (Optional - defaults shown)
CLAUDE_MODEL=claude-sonnet-4.5-20250514
OPENAI_MODEL=gpt-5
GEMINI_MODEL=gemini-2.5-pro-latest
GPT5_REASONING_EFFORT=high

# Memory (Optional - defaults shown)
MEMORY_RETENTION_DAYS=730
ENABLE_ENHANCED_MEMORY=true
```

### Policy Configuration

Edit `config/assistant-policy.json` to customize assistant behavior:

```json
{
  "memory": {
    "enabled": true,
    "retention_days": 730,
    "thread_aware": true
  },
  "agent_override": {
    "enabled": true,
    "allowed_operations": ["file", "shell", "sql"],
    "fallback_chain": ["claude", "gpt5", "gemini"]
  },
  "rate_limiting": {
    "window_ms": 900000,
    "max_requests": 100
  }
}
```

---

## 🏃 Running the System

### Development Mode

```bash
# Start all servers
npm run dev

# Or start individually:
npm run eidolon    # Eidolon SDK Server (Port 3101)
npm run agent      # Agent Server (Port 43717)
npm run gateway    # Gateway Server (Port 5000)
```

### Production Mode

```bash
NODE_ENV=production npm start
```

### Using the Setup Script

```bash
# Automated one-command setup
chmod +x scripts/setup.sh
./scripts/setup.sh
```

---

## 🔌 API Endpoints

### Gateway Server (Port 5000)

All requests require `X-Gateway-Key` header with your `GW_KEY`.

#### Eidolon Assistant

```bash
POST /eidolon/chat
Headers:
  X-Gateway-Key: <your-gw-key>
  X-Eidolon-Token: <your-eidolon-token>
Body:
  {
    "messages": [{"role": "user", "content": "Hello"}],
    "threadId": "optional-thread-id",
    "userId": "user-123"
  }
```

#### Agent Override (Atlas)

```bash
POST /agent/llm
Headers:
  X-Gateway-Key: <your-gw-key>
  X-Agent-Token: <your-agent-token>
Body:
  {
    "prompt": "Read package.json and summarize dependencies",
    "operation": "file_read",
    "context": {}
  }
```

#### Diagnostics

```bash
GET /api/diagnostics
Headers:
  X-Gateway-Key: <your-gw-key>
```

---

## 🧠 Memory System

### How It Works

1. **Automatic Storage**: All conversations are stored in PostgreSQL
2. **Thread Awareness**: Messages are grouped by `threadId`
3. **Context Retrieval**: Recent + relevant messages fetched for each request
4. **User Preferences**: Persistent settings across sessions
5. **Compaction**: Old entries pruned based on retention policy (730 days default)

### Database Schema

```sql
-- Conversations table
CREATE TABLE assistant_conversations (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  thread_id VARCHAR NOT NULL,
  role VARCHAR NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User preferences
CREATE TABLE assistant_user_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR UNIQUE NOT NULL,
  preferences JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Session state
CREATE TABLE assistant_sessions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  thread_id VARCHAR NOT NULL,
  state JSONB,
  last_activity TIMESTAMP DEFAULT NOW()
);
```

### Memory Compaction

```bash
# Manual compaction
npm run compact-memory

# Or via API
POST /eidolon/compact-memory
Headers:
  X-Eidolon-Token: <token>
```

---

## 🤖 Agent Override (Atlas)

### What It Does

Agent Override provides LLM-powered workspace intelligence with:

- **File Operations**: Read, write, search files
- **Shell Commands**: Execute system commands
- **SQL Queries**: Database operations
- **Fallback Chain**: Automatic provider switching

### Fallback Chain

1. **Primary (Claude Sonnet 4.5)**: Fast, accurate, context-aware
2. **Fallback 1 (GPT-5 Pro)**: Deep reasoning, extended thinking
3. **Fallback 2 (Gemini 2.5 Pro)**: Large context window, validation

### Example Usage

```javascript
// File operation
const response = await fetch('http://localhost:5000/agent/llm', {
  method: 'POST',
  headers: {
    'X-Gateway-Key': process.env.GW_KEY,
    'X-Agent-Token': process.env.AGENT_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: 'Find all TODO comments in src/ directory',
    operation: 'file_search'
  })
});
```

---

## 🚢 Deployment

### Docker (Recommended)

```bash
# Build image
docker build -t mega-assistant .

# Run container
docker run -d \
  -p 5000:5000 \
  -p 3101:3101 \
  -p 43717:43717 \
  --env-file .env \
  mega-assistant
```

### Manual Deployment

```bash
# Install dependencies
npm ci --production

# Run migrations
npm run db:push

# Start servers with PM2
pm2 start ecosystem.config.js
```

### Environment Setup

1. Set `NODE_ENV=production`
2. Use PostgreSQL with connection pooling
3. Enable rate limiting
4. Configure CORS for your domain
5. Use HTTPS in production

---

## 🔧 Troubleshooting

### Common Issues

#### 1. Database Connection Failed

```bash
# Check DATABASE_URL format
postgresql://user:password@host:port/database

# Test connection
psql $DATABASE_URL
```

#### 2. Authentication Errors

```bash
# Verify tokens are 64-character hex strings
echo $AGENT_TOKEN | wc -c  # Should be 65 (64 + newline)

# Regenerate if needed
openssl rand -hex 32
```

#### 3. Memory Not Persisting

```bash
# Check ENABLE_ENHANCED_MEMORY is true
echo $ENABLE_ENHANCED_MEMORY

# Verify database tables exist
psql $DATABASE_URL -c "\dt assistant_*"
```

#### 4. Agent Override Failing

```bash
# Check fallback chain order
# config/assistant-policy.json
"fallback_chain": ["claude", "gpt5", "gemini"]

# Verify all API keys are set
env | grep -E "ANTHROPIC|OPENAI|GOOGLE"
```

### Helper Scripts

```bash
# Check which assistant is running (Eidolon vs Vera)
npm run which-assistant

# Validate JSON files
npm run validate-json

# View diagnostics
curl -H "X-Gateway-Key: $GW_KEY" http://localhost:5000/api/diagnostics
```

---

## 📚 Additional Resources

- **Architecture Diagram**: See `docs/ARCHITECTURE.md`
- **API Reference**: See `docs/API_REFERENCE.md`
- **Memory System**: See `docs/MEMORY_SYSTEM.md`
- **Deployment Guide**: See `docs/DEPLOYMENT.md`

---

## 🤝 Support

For issues, questions, or contributions:

1. Check the troubleshooting section
2. Review helper scripts in `scripts/`
3. Check diagnostics endpoint: `/api/diagnostics`
4. Review server logs

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🎯 Quick Start Checklist

- [ ] Copy Mega_Assistant_Port to your project
- [ ] Install dependencies: `npm install`
- [ ] Create database: `createdb assistant_db`
- [ ] Copy config: `cp config/.env.template .env`
- [ ] Generate tokens: `openssl rand -hex 32` (3x)
- [ ] Add API keys to `.env`
- [ ] Run migrations: `npm run db:push`
- [ ] Start servers: `npm run dev`
- [ ] Test endpoint: `curl http://localhost:5000/api/diagnostics`
- [ ] Configure policy: Edit `config/assistant-policy.json`
- [ ] Deploy to production

---

**Built with ❤️ for production-ready AI assistance**
