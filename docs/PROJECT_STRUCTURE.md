# Vecto Pilot™ - Project Structure

**Last Updated:** October 25, 2025

---

## 📁 Directory Organization

```
/
├── client/               # Frontend React application
│   └── src/             # React components, pages, hooks
│
├── server/              # Backend Node.js services
│   ├── eidolon/         # AI SDK server
│   ├── agent/           # Agent override system
│   ├── db/              # Database connection & RLS middleware
│   └── gateway/         # Gateway proxy server
│
├── shared/              # Shared types & schemas (frontend + backend)
│   └── schema.ts        # Drizzle database schema
│
├── migrations/          # Database migrations
│   ├── 001_init.sql     # Initial schema
│   ├── 002_memory_tables.sql  # Memory tables
│   └── 003_rls_security.sql   # RLS policies
│
├── tests/               # Testing infrastructure
│   ├── scripts/         # Utility scripts
│   │   ├── toggle-rls.js      # RLS toggle (enable/disable)
│   │   └── preflight-check.js # Pre-deployment verification
│   └── logs/            # Test & validation logs
│
├── docs/                # Project documentation
│   ├── DB_VERIFICATION_REPORT.md    # Database integrity report
│   ├── RLS_SECURITY_IMPLEMENTATION.md # Security documentation
│   ├── RLS_TOGGLE_GUIDE.md          # RLS usage guide
│   ├── ARCHITECTURE.md              # System architecture
│   └── [other docs...]
│
├── gateway-server.js    # Main entry point (MONO mode)
├── replit.md            # Project README & preferences
├── mono-mode.env        # Environment configuration
└── package.json         # Dependencies & scripts
```

---

## 🎯 Key Directories Explained

### `/client` - Frontend Application
React 18 + TypeScript + Vite 7
- Mobile-first design
- Radix UI + Tailwind CSS (shadcn/ui)
- TanStack Query for state management
- Wouter for routing

### `/server` - Backend Services
Node.js 22 + Express.js
- **Gateway:** Public-facing proxy (port 5174)
- **Eidolon SDK:** AI assistant & business logic
- **Agent:** Workspace intelligence layer
- **DB:** PostgreSQL connection pool & RLS middleware

### `/shared` - Common Code
TypeScript types shared between frontend and backend
- `schema.ts` - Drizzle ORM schema (single source of truth)
- Database types (insert/select schemas)
- Zod validation schemas

### `/migrations` - Database Evolution
SQL migration files (additive only)
- `001_init.sql` - Initial 16 tables
- `002_memory_tables.sql` - Memory system (3 tables)
- `003_rls_security.sql` - Security policies (30+ RLS policies)

### `/tests` - Testing & Utilities
Organized testing infrastructure
- **scripts/** - Utility scripts for DB management
- **logs/** - Test results and validation logs

### `/docs` - Documentation
All project documentation centralized
- Architecture guides
- Security implementation details
- Deployment checklists
- Historical test results

---

## 🔧 Important Files

### Configuration
- `mono-mode.env` - Environment variables (DB, API keys, etc.)
- `package.json` - Dependencies & npm scripts
- `.replit` - Replit deployment config
- `vite.config.ts` - Frontend build config
- `drizzle.config.ts` - Database ORM config

### Entry Points
- `gateway-server.js` - MONO mode server (runs everything)
- `client/src/main.tsx` - Frontend entry point

### Database
- `shared/schema.ts` - Database schema (Drizzle)
- `server/db/pool.js` - Connection pooling
- `server/db/rls-middleware.js` - RLS helpers

### Documentation
- `replit.md` - Project overview & user preferences
- `docs/RLS_SECURITY_IMPLEMENTATION.md` - Security details
- `docs/DB_VERIFICATION_REPORT.md` - Database integrity
- `docs/PROJECT_STRUCTURE.md` - This file

---

## 🚀 npm Scripts Reference

### Development
```bash
npm start           # Start app in production mode
npm run dev         # Start app in development mode
```

### Database
```bash
npm run db:push     # Push schema changes to database
npm run db:studio   # Open Drizzle Studio (DB GUI)
```

### Security (RLS)
```bash
npm run rls:status   # Check RLS status
npm run rls:enable   # Enable RLS (production)
npm run rls:disable  # Disable RLS (development)
npm run preflight    # Pre-deployment check
```

### Testing
```bash
npm run test:app       # Visual test runner
npm run test:phases    # Run all test phases
```

---

## 📦 Key Dependencies

### Frontend
- `react` v18 - UI framework
- `@tanstack/react-query` v5 - State management
- `wouter` - Routing
- `react-hook-form` + `zod` - Form validation
- `@radix-ui/*` - UI components
- `tailwindcss` - Styling
- `lucide-react` - Icons

### Backend
- `express` - HTTP server
- `pg` - PostgreSQL client
- `drizzle-orm` - Database ORM
- `cors` - CORS middleware
- `express-rate-limit` - Rate limiting
- `helmet` - Security headers

### AI/APIs
- `@anthropic-ai/sdk` - Claude API
- `openai` - GPT-5 API
- `@google/generative-ai` - Gemini API
- `@googlemaps/js-api-loader` - Google Maps

---

## 🗄️ Database Schema Overview

**Provider:** Neon PostgreSQL 17.5  
**Tables:** 19 total  
**Columns:** 200+  

### Table Categories:

**User Data (9 tables):**
- snapshots, actions, rankings
- venue_feedback, strategy_feedback
- assistant_memory, eidolon_memory, cross_thread_memory, agent_memory

**System Data (6 tables):**
- triad_jobs, http_idem, venue_metrics
- llm_venue_suggestions, travel_disruptions, app_feedback

**Public Data (2 tables):**
- venue_catalog, places_cache

**Linked Data (2 tables):**
- strategies (via snapshot_id)
- ranking_candidates (via ranking_id)

---

## 🔒 Security Features

### Row Level Security (RLS)
- 30+ policies protecting all 19 tables
- Session variable-based access control
- Defense-in-depth architecture
- Toggle scripts for dev/prod modes

### Authentication Ready
- User-scoped policies in place
- System-scoped for admin operations
- Public-read policies for catalog data
- Ready for JWT/session integration

---

## 📝 File Naming Conventions

### Scripts
- Kebab-case: `toggle-rls.js`, `preflight-check.js`
- Descriptive names showing purpose
- Location in comments at top of file

### Documentation
- UPPERCASE for important guides: `README.md`, `ARCHITECTURE.md`
- PascalCase for reports: `DB_VERIFICATION_REPORT.md`
- Descriptive titles: `RLS_SECURITY_IMPLEMENTATION.md`

### Logs
- Lowercase with timestamps: `test-results-1761273135.log`
- Descriptive prefixes: `system-validation-*.log`

### Migrations
- Sequential numbering: `001_`, `002_`, `003_`
- Descriptive names: `init.sql`, `memory_tables.sql`, `rls_security.sql`

---

## 🎯 Quick Start Commands

### First Time Setup
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example mono-mode.env
# Edit mono-mode.env with your DATABASE_URL

# Push database schema
npm run db:push

# Start app
npm start
```

### Before Deployment
```bash
# Run preflight check
npm run preflight

# Enable RLS security
npm run rls:enable

# Verify
npm run rls:status
```

### Development Workflow
```bash
# Disable RLS for easier testing
npm run rls:disable

# Start dev server
npm run dev

# Check logs
tail -f tests/logs/*.log
```

---

## 📚 Additional Resources

- **Architecture:** `docs/ARCHITECTURE.md`
- **Database:** `docs/DB_VERIFICATION_REPORT.md`
- **Security:** `docs/RLS_SECURITY_IMPLEMENTATION.md`
- **Deployment:** `docs/DEPLOYMENT_CHECKLIST.md`
- **RLS Guide:** `docs/RLS_TOGGLE_GUIDE.md`

---

**Project:** Vecto Pilot™  
**Version:** 4.1.0  
**Node:** 22.17.0  
**PostgreSQL:** 17.5 (Neon)
