# Quick Installation Guide

## One-Command Setup

```bash
chmod +x scripts/setup.sh && ./scripts/setup.sh
```

## Manual Installation

### 1. Prerequisites

- Node.js 20.x or higher
- PostgreSQL 14+
- API keys: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini)

### 2. Install & Configure

```bash
# Install dependencies
npm install

# Setup environment
cp config/.env.template .env

# Generate security tokens (run 3 times)
openssl rand -hex 32

# Edit .env with your values
nano .env
```

### 3. Database Setup

```bash
# Create database
createdb mega_assistant_db

# Update .env
DATABASE_URL=postgresql://user:password@localhost:5432/mega_assistant_db

# Run migrations
npm run db:push
```

### 4. Start Servers

```bash
# Development
npm run dev

# Production
NODE_ENV=production npm start
```

## Verify Installation

```bash
# Check which assistant is running
npm run which-assistant

# Test diagnostics endpoint
curl -H "X-Gateway-Key: $GW_KEY" http://localhost:5000/api/diagnostics
```

## Next Steps

- See [README.md](README.md) for full documentation
- See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production deployment
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system architecture
