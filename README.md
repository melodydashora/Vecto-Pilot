# Vecto Pilot™

[![CI](https://github.com/YOUR-ORG/vecto-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR-ORG/vecto-pilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**AI-Powered Rideshare Intelligence Platform** - Maximize driver earnings through real-time, data-driven strategic briefings.

---

## 🎯 Overview

Vecto Pilot is a **location-agnostic rideshare intelligence platform** that works globally. It provides drivers with AI-powered strategic briefings, venue recommendations, and tactical intelligence to maximize earnings.

### Key Features

- ✅ **AI Strategy Pipeline**: Claude (Strategist) → Perplexity (Briefer) → GPT-5 (Consolidator)
- ✅ **Smart Blocks System**: Structured content with 7 block types (header, paragraph, list, quote, CTA, image, divider)
- ✅ **Real-time Updates**: SSE/NOTIFY event-driven architecture (zero polling)
- ✅ **Immutable History**: Strategy retry workflow with full audit trail
- ✅ **Global Support**: 100% location-agnostic, works anywhere in the world
- ✅ **Block Schema Contract**: Type-safe API with automated validation

### Tech Stack

**Frontend**: React + TypeScript + Vite + TailwindCSS + Radix UI  
**Backend**: Node.js + Express + PostgreSQL + Drizzle ORM  
**AI**: Anthropic Claude + OpenAI GPT-5 + Google Gemini + Perplexity  
**Testing**: Jest (19 tests) + Playwright (14 tests) = **33 automated tests**  
**CI/CD**: GitHub Actions with PostgreSQL service

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/YOUR-ORG/vecto-pilot.git
cd vecto-pilot

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys and database URL

# Run database migrations
npm run db:push

# Start development server
npm run dev
```

Visit `http://localhost:5000` to see the app.

---

## 🧪 Testing

### Quick Test Suite

```bash
# Run complete test suite (Seed + Jest + Playwright)
./scripts/test-all.sh
```

This runs:
1. Seeds test database
2. Runs 19 Jest unit tests (API contract)
3. Runs 14 Playwright E2E tests (browser UX)

### Individual Test Commands

```bash
# Seed test data
node scripts/seed-dev.js

# Jest unit tests only
npm run test:blocks

# Playwright E2E tests only
npx playwright test

# Playwright interactive mode
npx playwright test --ui
```

### Test Coverage

| Layer | Framework | Tests | What It Tests |
|-------|-----------|-------|---------------|
| **Unit** | Jest | 19 | API contract, block schema validation |
| **E2E** | Playwright | 14 | Browser rendering, user interactions |
| **Total** | - | **33** | Full stack (DB → API → React → DOM) |

---

## 🚦 Contributor Guide

Welcome! Before you open a PR, please make sure:

### 1. Run migrations locally
```bash
npm run db:push
```

### 2. Seed the database
```bash
node scripts/seed-dev.js
```

### 3. Run all tests
```bash
# Complete test suite
./scripts/test-all.sh

# Or run individually
npm run test:blocks
npx playwright test
```

### 4. Check code quality
```bash
# TypeScript check
npm run typecheck

# ESLint check
npm run lint
```

### 5. Check CI badge

PRs will **not be merged** unless the CI badge is green ✅.

CI enforces:
- ✅ **Schema contract** (Jest unit tests)
- ✅ **Block API contract** (Jest unit tests)
- ✅ **UI rendering** (Playwright E2E tests)
- ✅ **End-to-end workflow** (Seed → API → UI)

### Workflow Contract Rules

**Respect the workflow contract:**

1. **Never overwrite rows** — Retries always create new snapshots
2. **Only allowed status transitions**: `pending → complete|failed|write_failed`
3. **SSE (`strategy_ready`)** is the single source of truth for readiness
4. **Update documentation** if you add new statuses or block types

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for detailed guidelines.

---

## 📚 Documentation

### Core Documentation
- [Block Schema Contract](docs/BLOCK-SCHEMA-CONTRACT.md) - Schema specification
- [Testing Guide](docs/TESTING-GUIDE.md) - Complete testing strategy
- [CI/CD Documentation](docs/CI-CD.md) - Workflow architecture
- [Implementation Summary](docs/IMPLEMENTATION-SUMMARY.md) - Complete overview

### API Documentation
- [Strategy API](docs/api/STRATEGY.md) - Strategy endpoints
- [Blocks API](docs/api/BLOCKS.md) - Content blocks endpoints
- [Chat API](docs/api/CHAT.md) - AI Strategy Coach

### Development Guides
- [Contributing Guide](docs/CONTRIBUTING.md) - How to contribute
- [Architecture](docs/ARCHITECTURE.md) - System architecture
- [Deployment](docs/DEPLOYMENT.md) - Deployment guide

---

## 🏗️ Architecture

### Multi-Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Gateway Server                         │
│  (Routes traffic, serves SPA, manages child processes)  │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐   ┌──────────┐
    │   SDK    │    │  Agent   │   │  Triad   │
    │  Server  │    │  Server  │   │  Worker  │
    └──────────┘    └──────────┘   └──────────┘
          │               │               │
          └───────────────┴───────────────┘
                          ▼
                  ┌──────────────┐
                  │  PostgreSQL  │
                  │   Database   │
                  └──────────────┘
```

### AI Pipeline (Event-Driven)

```
1. Strategist (Claude)
   └─ Generates strategic overview
   └─ Writes to strategies.minstrategy
   └─ Triggers NOTIFY event

2. Briefer (Perplexity sonar-pro)
   └─ Comprehensive travel research
   └─ Writes to briefings table
   └─ Triggers NOTIFY event

3. Consolidator (GPT-5)
   └─ Independent web research
   └─ 30-minute tactical guidance
   └─ Writes to strategies.consolidated_strategy
   └─ Triggers NOTIFY event → strategy_ready
```

---

## 🔧 Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/vecto

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=pplx-...

# Google Maps
GOOGLE_MAPS_API_KEY=AIza...

# Server
PORT=5000
NODE_ENV=development
```

See `.env.example` for complete configuration.

---

## 📊 Block Schema Contract

Vecto Pilot uses a strict **Block Schema Contract** ensuring consistency between backend API and frontend rendering.

### Supported Block Types

| Type | Fields | Example Use |
|------|--------|-------------|
| **header** | text, level (1-3) | Section titles |
| **paragraph** | text | Body content |
| **list** | items[], style (bullet/number) | Action items, tips |
| **image** | url, caption | Visual content |
| **quote** | text, author | Motivational quotes |
| **cta** | label, action, variant | Call-to-action buttons |
| **divider** | (none) | Visual separation |

### Example API Response

```json
{
  "snapshot_id": "abc-123",
  "blocks": [
    {
      "id": "b1",
      "type": "header",
      "order": 1,
      "text": "Morning Strategy",
      "level": 2
    },
    {
      "id": "b2",
      "type": "list",
      "order": 2,
      "items": [
        "Focus on airport zones",
        "Peak hours: 6-9 AM"
      ],
      "style": "bullet"
    }
  ]
}
```

See [Block Schema Contract](docs/BLOCK-SCHEMA-CONTRACT.md) for full specification.

---

## 🎨 Smart Blocks Component

The **SmartBlock** component renders all 7 block types with:
- ✅ TypeScript type safety
- ✅ Dark mode support
- ✅ Status-specific styling
- ✅ Test IDs for automation

```tsx
import { SmartBlock } from '@/components/SmartBlock';

<SmartBlock block={block} />
```

---

## 🔒 Security

- ✅ **JWT Authentication**: RS256 asymmetric keys
- ✅ **Rate Limiting**: Express rate limiter
- ✅ **CORS Protection**: Configured origins
- ✅ **Helmet.js**: Security headers
- ✅ **Path Traversal Protection**: Validated file paths
- ✅ **File Size Limits**: 1MB request body limit

---

## 🚀 Deployment

### Development
```bash
npm run dev
```

### Production
```bash
npm run build:client
npm start
```

### Environment Modes
- **Mono Mode**: All services in one process
- **Split Mode**: Separate Gateway, SDK, and Agent servers

See [Deployment Guide](docs/DEPLOYMENT.md) for details.

---

## 🧪 CI/CD Pipeline

GitHub Actions automatically runs on every PR:

1. ✅ **Quick Checks** (~2 min): TypeScript + ESLint
2. ✅ **Full CI** (~8 min): 33 automated tests
   - PostgreSQL 15 service
   - Database migrations
   - Seed test data
   - 19 Jest unit tests
   - 14 Playwright E2E tests
3. ✅ **Artifacts**: Test reports & screenshots (7 days)

See [CI/CD Documentation](docs/CI-CD.md) for details.

---

## 📈 Performance

- **Strategy Generation**: 10-30 seconds (3-stage AI pipeline)
- **API Response Time**: <200ms (cached data)
- **UI Load Time**: <2 seconds (Vite optimized)
- **Database Queries**: <50ms (indexed)
- **Test Suite**: ~2 min local, ~8 min CI

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](docs/CONTRIBUTING.md) for:
- Code style guidelines
- Commit message format
- Pull request process
- Testing requirements
- Documentation standards

### Quick Contribution Workflow

```bash
# 1. Fork and clone
git clone https://github.com/YOUR-USERNAME/vecto-pilot.git

# 2. Create feature branch
git checkout -b feature/amazing-feature

# 3. Make changes and test
./scripts/test-all.sh

# 4. Commit (follow conventional commits)
git commit -m "feat: add amazing feature"

# 5. Push and create PR
git push origin feature/amazing-feature
```

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Anthropic** - Claude AI
- **OpenAI** - GPT-5
- **Google** - Gemini AI
- **Perplexity** - sonar-pro research
- **Replit** - Development platform
- **Contributors** - Everyone who helped build this

---

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/YOUR-ORG/vecto-pilot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR-ORG/vecto-pilot/discussions)

---

## 🗺️ Roadmap

- [ ] Mobile app (React Native)
- [ ] Offline mode support
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Driver community features
- [ ] Integration with rideshare APIs

---

**Built with ❤️ for rideshare drivers worldwide**

---

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/YOUR-ORG/vecto-pilot)
![GitHub forks](https://img.shields.io/github/forks/YOUR-ORG/vecto-pilot)
![GitHub issues](https://img.shields.io/github/issues/YOUR-ORG/vecto-pilot)
![GitHub pull requests](https://img.shields.io/github/issues-pr/YOUR-ORG/vecto-pilot)

**Test Coverage**: 33 automated tests (19 Jest + 14 Playwright)  
**CI/CD**: GitHub Actions (3 workflows)  
**Documentation**: 6 comprehensive guides  
**Status**: Production Ready 🚀
