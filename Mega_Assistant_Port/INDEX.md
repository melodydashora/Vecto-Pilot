# 📚 Mega Assistant Port - Documentation Index

Welcome to the **Mega Assistant Port** documentation! This index will help you find exactly what you need.

## 🚀 Getting Started

**New to this package?** Start here:

1. **[PACKAGE_SUMMARY.md](PACKAGE_SUMMARY.md)** - Overview, features, and quick comparison
2. **[INSTALLATION.md](INSTALLATION.md)** - Quick installation guide (< 5 minutes)
3. **[README.md](README.md)** - Complete user guide and API reference

## 📖 Documentation Files

### Essential Reading

| Document | Purpose | When to Read |
|----------|---------|--------------|
| [PACKAGE_SUMMARY.md](PACKAGE_SUMMARY.md) | High-level overview, features, comparisons | First time setup |
| [INSTALLATION.md](INSTALLATION.md) | Quick installation steps | Setting up the package |
| [README.md](README.md) | Complete documentation and API reference | Learning to use the system |

### Technical Documentation

| Document | Purpose | When to Read |
|----------|---------|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design | Understanding internals |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment guide | Going to production |
| [MANIFEST.md](MANIFEST.md) | Detailed package contents | Exploring the codebase |

### Reference

| File | Purpose |
|------|---------|
| [LICENSE](LICENSE) | MIT License terms |
| [.gitignore](.gitignore) | Git ignore rules |
| [package.json](package.json) | Dependencies and scripts |

## 🎯 Quick Navigation by Task

### I want to...

**Install the package**
→ [INSTALLATION.md](INSTALLATION.md) → [README.md](README.md)

**Understand what this does**
→ [PACKAGE_SUMMARY.md](PACKAGE_SUMMARY.md)

**Learn the architecture**
→ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

**Deploy to production**
→ [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

**See all files included**
→ [MANIFEST.md](MANIFEST.md)

**Use the API**
→ [README.md - API Endpoints](README.md#-api-endpoints)

**Troubleshoot issues**
→ [README.md - Troubleshooting](README.md#-troubleshooting)

**Integrate into my project**
→ [PACKAGE_SUMMARY.md - Integration](PACKAGE_SUMMARY.md#-integration-strategies)

## 🔧 Configuration Files

### Required Setup

1. **[config/.env.template](config/.env.template)** - Environment configuration template
   - Copy to `.env` and fill in your values
   - Generate tokens: `openssl rand -hex 32`

2. **[config/assistant-policy.json](config/assistant-policy.json)** - Assistant behavior policy
   - Controls memory, agent override, rate limiting

3. **[config/policy.default.json](config/policy.default.json)** - Default policy settings

## 🛠️ Helper Scripts

Located in `scripts/`:

- **[setup.sh](scripts/setup.sh)** - Automated setup wizard
  ```bash
  chmod +x scripts/setup.sh && ./scripts/setup.sh
  ```

- **[which-assistant.mjs](scripts/which-assistant.mjs)** - Identify assistant type
  ```bash
  npm run which-assistant
  ```

- **[find-json-errors.mjs](scripts/find-json-errors.mjs)** - JSON validation
  ```bash
  npm run validate-json
  ```

## 🗂️ Directory Structure

```
Mega_Assistant_Port/
├── servers/               # 3 server files (Gateway, Eidolon, Agent)
├── lib/                   # Core libraries
│   ├── eidolon/          # Enhanced assistant system
│   ├── agent/            # Agent Override (Atlas)
│   └── shared/           # Shared utilities
├── config/               # Configuration files
├── scripts/              # Helper scripts
├── docs/                 # Technical documentation
├── README.md             # Main documentation
├── INSTALLATION.md       # Quick setup
├── PACKAGE_SUMMARY.md    # Overview & features
├── MANIFEST.md           # Package contents
├── INDEX.md              # This file
├── LICENSE               # MIT License
└── package.json          # Dependencies & scripts
```

## 📋 Common Tasks

### Setup & Installation
1. Read [INSTALLATION.md](INSTALLATION.md)
2. Run `npm install`
3. Copy `config/.env.template` to `.env`
4. Run `npm run setup` or setup manually

### Development
```bash
npm run dev          # Start all servers
npm run eidolon      # Eidolon SDK only
npm run agent        # Agent server only
npm run gateway      # Gateway only
```

### Production
```bash
NODE_ENV=production npm start
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for PM2, Docker, cloud options.

### Maintenance
```bash
npm run db:push         # Push schema changes
npm run compact-memory  # Clean old memory
npm run doctor          # Health check
npm run which-assistant # Identify assistant
npm run validate-json   # Validate configs
```

## 🎓 Learning Path

### Beginner
1. Read [PACKAGE_SUMMARY.md](PACKAGE_SUMMARY.md) - Understand what this is
2. Follow [INSTALLATION.md](INSTALLATION.md) - Get it running
3. Read [README.md - API Endpoints](README.md#-api-endpoints) - Learn the API

### Intermediate
1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Understand the system
2. Review [MANIFEST.md](MANIFEST.md) - Explore the codebase
3. Read [README.md - Memory System](README.md#-memory-system) - Learn memory

### Advanced
1. Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Production setup
2. Study `lib/eidolon/` and `lib/agent/` - Dive into code
3. Customize `config/assistant-policy.json` - Tune behavior

## 🆘 Getting Help

### Troubleshooting

1. **Check diagnostics**
   ```bash
   curl -H "X-Gateway-Key: $GW_KEY" http://localhost:5000/api/diagnostics
   ```

2. **Run health check**
   ```bash
   npm run doctor
   ```

3. **Read troubleshooting guide**
   → [README.md - Troubleshooting](README.md#-troubleshooting)
   → [docs/DEPLOYMENT.md - Troubleshooting](docs/DEPLOYMENT.md#-troubleshooting)

### Common Issues

- **Database errors**: [README.md - Troubleshooting](README.md#1-database-connection-failed)
- **Auth errors**: [README.md - Troubleshooting](README.md#2-authentication-errors)
- **Memory issues**: [README.md - Troubleshooting](README.md#3-memory-not-persisting)
- **Deployment issues**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#-troubleshooting)

## 📊 Package Stats

- **Total Files**: 42
- **Lines of Code**: 6,577
- **Package Size**: 400KB (without node_modules)
- **Documentation**: 7 files, ~40KB
- **Setup Time**: < 5 minutes

## 🔗 External Resources

- **Anthropic Claude**: https://docs.anthropic.com/
- **OpenAI GPT-5**: https://platform.openai.com/docs/
- **Google Gemini**: https://ai.google.dev/docs
- **PostgreSQL**: https://www.postgresql.org/docs/
- **Drizzle ORM**: https://orm.drizzle.team/docs/

## 📝 Quick Reference

### Environment Variables
```bash
# Required
AGENT_TOKEN, EIDOLON_TOKEN, GW_KEY
ANTHROPIC_API_KEY, OPENAI_API_KEY
DATABASE_URL

# Optional
GOOGLE_API_KEY, MEMORY_RETENTION_DAYS
RATE_LIMIT_MAX_REQUESTS, LOG_LEVEL
```

### API Endpoints
- `POST /eidolon/chat` - Chat with assistant
- `POST /agent/llm` - Agent operations
- `GET /api/diagnostics` - Health check

### NPM Scripts
- `npm run dev` - Development mode
- `npm start` - Production mode
- `npm run setup` - Automated setup
- `npm run db:push` - Database migration

---

**Need help?** Check the [troubleshooting sections](README.md#-troubleshooting) or run `npm run doctor`

**Ready to deploy?** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

**Want to learn more?** Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
