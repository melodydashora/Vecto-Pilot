# 🚀 Vecto Pilot™ - Deployment Package

## Quick Start (For GPT-5)

This is a complete, production-ready deployment package for **Vecto Pilot™**, a strategic rideshare driver assistance platform with AI-powered recommendations.

### Prerequisites

- Node.js 18+ 
- PostgreSQL database
- API Keys:
  - Anthropic (Claude Sonnet 4.5)
  - OpenAI (GPT-5)
  - Google (Gemini 2.5 Pro, Maps APIs)
  - Perplexity (optional, for web research)

### Installation Steps

```bash
# 1. Extract the zip file
unzip vecto-pilot-clean.zip
cd vecto-pilot

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your actual API keys and database URL

# 4. Set up database
npm run db:push

# 5. Start the application
npm run dev
```

The app will be available at `http://localhost:5000`

## 📁 Package Contents

### Core Application
```
client/                  # React frontend (TypeScript + Vite)
├── src/
│   ├── pages/          # Route pages
│   ├── components/     # UI components (shadcn/ui)
│   ├── contexts/       # React contexts (LocationContext)
│   ├── hooks/          # Custom hooks
│   └── lib/            # Utilities

server/                  # Node.js backend (Express)
├── api/                # API route handlers
├── eidolon/            # Eidolon SDK integration
├── gateway/            # Assistant override proxy
├── agent/              # Agent operations server
├── db/                 # Database layer
├── lib/                # Server utilities
└── middleware/         # Express middleware

shared/                  # Shared types and schemas
├── schema.ts           # Drizzle ORM schemas
└── types/              # TypeScript definitions
```

### Configuration
```
.env.example            # Environment template (MUST configure)
package.json            # Dependencies and scripts
tsconfig.json           # TypeScript config
vite.config.ts          # Vite bundler config
tailwind.config.ts      # Tailwind CSS config
drizzle.config.ts       # Database ORM config
```

### Documentation
```
ARCHITECTUREV2.md       # Complete system architecture
ARCHITECTUREV2.pdf      # Professional PDF version
replit.md               # Project context and preferences
ASSISTANT-OVERRIDE-README.md  # AI assistant setup
models-dictionary.json  # Model specifications
```

### Assistant Override System
```
server/gateway/assistant-proxy.ts  # Triad pipeline proxy
server/agent/index.ts              # Operations server
config/eidolon-policy.json        # SDK policy
config/assistant-policy.json      # Capabilities config
.replit-assistant-override.json   # Routing config
```

## 🔧 Configuration Required

### 1. Database Setup

Set `DATABASE_URL` in `.env`:
```bash
DATABASE_URL=postgres://user:password@host:5432/dbname
PGSSLMODE=require
```

Then run:
```bash
npm run db:push
```

### 2. API Keys (Required)

Edit `.env` and add:
```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
GOOGLE_API_KEY=...
```

### 3. Security Tokens

Generate secure tokens:
```bash
# Generate tokens (run 4 times for all tokens)
openssl rand -hex 32

# Add to .env
AGENT_TOKEN=<generated>
EIDOLON_TOKEN=<generated>
ASSISTANT_OVERRIDE_TOKEN=<generated>
GW_KEY=<generated>
```

### 4. Model Configuration

The app uses these models (already configured in `.env.example`):
- **Claude Sonnet 4.5** (20250929) - Strategist
- **GPT-5** - Deep reasoning planner
- **Gemini 2.5 Pro** - Validator
- **Perplexity Sonar Pro** - Web research (optional)

## 📦 Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run build           # Build for production
npm run start           # Start production server

# Database
npm run db:push         # Push schema to database
npm run db:push -- --force  # Force push (if needed)

# Assistant Override
npm run gateway:proxy    # Start gateway proxy
npm run agent:server     # Start agent server
npm run override:start   # Start both in parallel

# Testing & Verification
npm run typecheck       # TypeScript type checking
npm run lint            # ESLint code linting
npm run model:verify    # Verify model availability
```

## 🏗️ Architecture Overview

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + PostgreSQL
- **AI Models**: Claude Sonnet 4.5, GPT-5, Gemini 2.5 Pro
- **State Management**: @tanstack/react-query
- **Database ORM**: Drizzle ORM
- **UI Components**: Radix UI + shadcn/ui

### Key Features
1. **Real-time Location Context** - GPS, weather, air quality, traffic
2. **AI-Powered Recommendations** - Triad pipeline (Claude → GPT-5 → Gemini)
3. **Fast Tactical Optimization** - Sub-7s response times (p95 ≤ 7.0s)
4. **Atomic Database Persistence** - ACID guarantees for ML training data
5. **Enhanced Assistant Override** - 200K context, persistent memory
6. **Worldwide Venue Generation** - Works anywhere, no pre-existing catalog needed

### Triad Pipeline
```
User Request
    ↓
Claude Sonnet 4.5 (Strategist)
    ↓
GPT-5 (Planner - High Reasoning)
    ↓
Gemini 2.5 Pro (Validator)
    ↓
Response (6 venue recommendations)
```

## 🗄️ Database Schema

The app includes 15+ tables for ML training data:
- `rankings` - Ranking metadata
- `ranking_candidates` - Individual venue candidates
- `strategies` - AI-generated strategies
- `snapshots` - Location context snapshots
- `actions` - User actions for counterfactual learning
- `venue_feedback` - Per-ranking feedback
- And more...

Run `npm run db:push` to create all tables.

## 🌍 Environment Variables Reference

See `.env.example` for complete reference. Critical variables:

### Database
```bash
DATABASE_URL=postgres://...
```

### API Keys
```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
GOOGLE_API_KEY=...
```

### Ports
```bash
GATEWAY_PORT=5000
EIDOLON_PORT=3101
AGENT_PORT=43717
```

### Model Configuration
```bash
CLAUDE_MODEL=claude-sonnet-4-5-20250929
OPENAI_MODEL=gpt-5
GEMINI_MODEL=gemini-2.5-pro
```

### Budgets & Timeouts
```bash
LLM_TOTAL_BUDGET_MS=120000
CLAUDE_TIMEOUT_MS=20000
GPT5_TIMEOUT_MS=60000
GEMINI_TIMEOUT_MS=20000
```

## 🔒 Security Notes

### Production Deployment

1. **Never commit `.env`** - Contains sensitive API keys
2. **Restrict shell access** - Set `AGENT_SHELL_WHITELIST` to specific commands only
3. **Use read-only DB** - Set `AGENT_ALLOW_SQL_DDL=false` in production
4. **Rotate tokens** - Change security tokens regularly
5. **Enable rate limiting** - Already configured in Express middleware

### Recommended Production Settings
```bash
NODE_ENV=production
AGENT_SHELL_WHITELIST=ls,cat,npm,node,git  # Not '*'
AGENT_ALLOW_SQL_DDL=false
AGENT_ALLOW_FS_DELETE=false
```

## 📊 Monitoring & Debugging

### Logs
Application logs to console with structured logging. Check:
- Server logs: stdout/stderr
- Browser console: Developer tools
- Database queries: Enable Drizzle logging in development

### Performance Metrics
The app targets:
- **p95 response time**: ≤ 7.0s
- **p50 response time**: ≤ 4.0s
- **Triad pipeline**: 120s total budget

### Health Checks
- **GET /health** - Server health
- **GET /api/health** - API health
- **Database**: Connection pool status

## 🐛 Troubleshooting

### "Module not found" errors
```bash
npm install
```

### Database connection errors
- Check `DATABASE_URL` in `.env`
- Ensure PostgreSQL is running
- Verify SSL settings (`PGSSLMODE`)

### Port already in use
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9
```

### TypeScript errors
```bash
npm run typecheck
```

### API key errors
- Verify keys in `.env` are correct
- Check key quotas/limits
- Ensure models are available in your region

## 📚 Documentation

- **Architecture**: `ARCHITECTUREV2.md` - Complete system design
- **Architecture PDF**: `ARCHITECTUREV2.pdf` - Professional formatted
- **Models**: `models-dictionary.json` - All model specifications
- **Assistant Override**: `ASSISTANT-OVERRIDE-README.md` - AI assistant setup
- **Project Context**: `replit.md` - User preferences and history

## 🆘 Support

For issues:
1. Check `ARCHITECTUREV2.md` for detailed architecture
2. Review error logs
3. Verify `.env` configuration
4. Check database connectivity
5. Ensure API keys are valid

## 📜 License

MIT License - See package.json

## 🏆 Credits

- **Vecto Pilot™** - Strategic rideshare assistance platform
- **Eidolon Enhanced SDK** - Complete assistant replacement
- **Models**: Claude Sonnet 4.5, GPT-5, Gemini 2.5 Pro, Perplexity Sonar Pro

---

**Version**: 4.1.0  
**Last Updated**: October 2025  
**Node.js**: 18+  
**Database**: PostgreSQL 14+
