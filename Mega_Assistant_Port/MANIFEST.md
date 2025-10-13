# Mega Assistant Port - Package Manifest

## 📦 Package Contents

### Servers (3 files)
- `servers/eidolon-sdk-server.js` - Main AI assistant server
- `servers/agent-server.js` - Agent Override (Atlas) server
- `servers/gateway-server.js` - Public-facing gateway with auth

### Core Libraries

#### Eidolon System (`lib/eidolon/`)
- `core/` - Core assistant functionality
  - `code-map.ts` - Code understanding and navigation
  - `context-awareness.ts` - Smart context retrieval
  - `deep-thinking-engine.ts` - Advanced reasoning
  - `deployment-tracker.ts` - Deployment monitoring
  - `llm.ts` - LLM provider abstraction
  - `memory-enhanced.ts` - Enhanced memory system
  - `memory-store.ts` - Memory persistence
- `memory/` - Memory management
  - `compactor.js` - Automatic memory cleanup
  - `pg.js` - PostgreSQL adapter
- `tools/` - Assistant tools
  - `mcp-diagnostics.js` - System diagnostics
  - `sql-client.ts` - SQL operations
- `config.ts` - Eidolon configuration
- `index.ts` - Main export
- `policy-loader.js` - Policy loading
- `policy-middleware.js` - Policy enforcement

#### Agent System (`lib/agent/`)
- `agent-override-llm.js` - LLM-powered workspace operations
- `config-manager.js` - Configuration management
- `context-awareness.js` - Agent context system
- `enhanced-context.js` - Enhanced context retrieval
- `routes.js` - Agent API routes
- `thread-context.js` - Thread-aware context

#### Shared Libraries (`lib/shared/`)
- `capabilities.js` - System capabilities
- `auth.js` - Authentication middleware
- `ability-routes.js` - Ability-based routing

### Configuration (`config/`)
- `.env.template` - Environment configuration template
- `assistant-policy.json` - Assistant behavior policy
- `policy.default.json` - Default policy settings

### Helper Scripts (`scripts/`)
- `setup.sh` - Automated setup script
- `which-assistant.mjs` - Identify assistant (Eidolon vs Vera)
- `find-json-errors.mjs` - JSON validation tool

### Documentation (`docs/`)
- `ARCHITECTURE.md` - System architecture overview
- `DEPLOYMENT.md` - Comprehensive deployment guide

### Root Files
- `README.md` - Main documentation (14KB)
- `INSTALLATION.md` - Quick installation guide
- `package.json` - Dependencies and scripts
- `LICENSE` - MIT License
- `.gitignore` - Git ignore rules
- `MANIFEST.md` - This file

## 🔑 Key Features

### Three-Server Architecture
1. **Gateway** (Port 5000) - Public proxy with auth & rate limiting
2. **Eidolon SDK** (Port 3101) - Main AI assistant with memory
3. **Agent** (Port 43717) - Workspace intelligence (Atlas)

### Enhanced Memory System
- PostgreSQL-backed persistence
- 730-day retention (configurable)
- Thread-aware context
- Cross-session continuity
- Automatic compaction

### Agent Override (Atlas)
- File operations (read, write, search)
- Shell command execution
- SQL query operations
- Fallback chain: Claude → GPT-5 → Gemini

### Security Features
- Token-based authentication (3 tokens)
- Rate limiting (100 req/15min)
- CORS & Helmet protection
- Environment-based secrets

## 📊 Statistics

- **Total Files**: ~30
- **Lines of Code**: ~5,000+ (estimated)
- **Dependencies**: 15 production packages
- **Dev Dependencies**: 8 packages
- **Supported Platforms**: Linux, macOS, Windows (WSL)
- **Minimum Node.js**: v20.0.0
- **Database**: PostgreSQL 14+

## 🚀 Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp config/.env.template .env
# Edit .env with your values

# 3. Setup database
npm run db:push

# 4. Start servers
npm run dev
```

## 📝 Configuration Requirements

### Required Environment Variables
- `AGENT_TOKEN` - Agent server authentication
- `EIDOLON_TOKEN` - Eidolon SDK authentication
- `GW_KEY` - Gateway authentication
- `ANTHROPIC_API_KEY` - Claude API key
- `OPENAI_API_KEY` - GPT-5 API key
- `DATABASE_URL` - PostgreSQL connection string

### Optional Environment Variables
- `GOOGLE_API_KEY` - Gemini API key (for fallback)
- `MEMORY_RETENTION_DAYS` - Memory retention (default: 730)
- `RATE_LIMIT_MAX_REQUESTS` - Rate limit (default: 100)
- `LOG_LEVEL` - Logging level (default: info)

## 🔧 Available Commands

### Development
- `npm run dev` - Start all servers in parallel
- `npm run eidolon` - Start Eidolon SDK only
- `npm run agent` - Start Agent server only
- `npm run gateway` - Start Gateway only

### Database
- `npm run db:push` - Push schema changes
- `npm run db:push:force` - Force push (skip warnings)
- `npm run db:studio` - Open Drizzle Studio
- `npm run compact-memory` - Compact old memory

### Utilities
- `npm run setup` - Automated setup wizard
- `npm run which-assistant` - Check assistant type
- `npm run validate-json` - Validate JSON files
- `npm run doctor` - Health check

### Production
- `npm start` - Start in production mode

## 📦 Installation Size

- **Package**: ~50KB (without node_modules)
- **With Dependencies**: ~250MB
- **Database**: Variable (depends on usage)

## 🔄 Version History

- **v1.0.0** - Initial portable package release
  - Complete Eidolon SDK
  - Agent Override (Atlas)
  - Enhanced memory system
  - Production-ready deployment

## 🤝 Integration Guide

### Integrating into Existing Project

```bash
# 1. Copy to your project
cp -r Mega_Assistant_Port /path/to/your/project/assistant

# 2. Install dependencies
cd /path/to/your/project/assistant
npm install

# 3. Configure .env
cp config/.env.template .env
# Add your values

# 4. Update your project's package.json
{
  "scripts": {
    "assistant": "cd assistant && npm run dev",
    "assistant:prod": "cd assistant && npm start"
  }
}
```

### Using as Standalone Service

```bash
# Run independently
cd Mega_Assistant_Port
npm run dev

# Or with Docker
docker build -t mega-assistant .
docker run -p 5000:5000 mega-assistant
```

## 📚 Additional Resources

- **API Documentation**: See `/docs/API_REFERENCE.md` (if available)
- **Troubleshooting**: See `README.md` section
- **Examples**: See `/examples` directory (if available)
- **Changelog**: See `CHANGELOG.md` (if available)

## 🛠️ Technology Stack

- **Runtime**: Node.js 20+
- **Language**: JavaScript (ES Modules), TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL + Drizzle ORM
- **AI Providers**: Anthropic, OpenAI, Google
- **Security**: Helmet, CORS, Rate Limiting
- **Proxy**: http-proxy-middleware

## ⚠️ Important Notes

1. **Security Tokens**: Always generate new tokens (never use defaults)
2. **API Keys**: Required for all three providers (Claude, GPT-5, Gemini)
3. **Database**: PostgreSQL must be running before starting servers
4. **Ports**: Ensure 5000, 3101, 43717 are available
5. **Memory**: Minimum 512MB RAM recommended

## 📄 License

MIT License - See LICENSE file for full text

---

**Package Created**: October 13, 2025  
**Last Updated**: October 13, 2025  
**Maintainer**: Mega Assistant Port Team  
**Support**: See README.md for troubleshooting
