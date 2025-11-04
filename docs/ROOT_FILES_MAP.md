
# Root Files Relationship Map

**Last Updated:** 2025-11-04  
**Purpose:** Document relationships between root-level files, their roles in the workflow, and interdependencies

---

## 📋 Entry Points & Workflow Files

### Primary Entry Point
```
gateway-server.js (PORT 5000)
├── Loaded by: npm run start:replit (via .replit workflow)
├── Depends on: 
│   ├── mono-mode.env (environment configuration)
│   ├── agent-ai-config.js (AI model configuration)
│   └── sdk-embed.js (embedded SDK routes)
├── Spawns:
│   └── strategy-generator.js (background worker)
└── Serves: client/dist (static SPA files)
```

### Workflow Definition
```
.replit
├── Defines: "Run App" workflow
├── Executes: scripts/start-replit.js
├── Loads: mono-mode.env (via shell source)
└── Configures: Modules, Nix packages, deployment settings
```

### Workflow Alternative
```
.replit.workflows.json
├── Status: Legacy/alternative workflow definition
├── Defines: Multi-process workflows (Agent + Gateway)
└── Used by: Manual workflow selection (not Run button)
```

---

## 🔧 Configuration Files

### Environment Configuration
```
mono-mode.env
├── Used by: ALL server processes
├── Contains: Database URL, API keys, feature flags
├── Template: mono-mode.env.example
└── Loaded by: 
    ├── gateway-server.js (via shell source)
    ├── start-mono.sh (via shell source)
    └── scripts/start-replit.js (Node.js dotenv)
```

### Build Configuration
```
package.json
├── Defines: Dependencies, npm scripts
├── Scripts used in workflow:
│   ├── start:replit → scripts/start-replit.js
│   ├── build:client → vite build (client directory)
│   └── db:push → drizzle-kit migrations
└── Dependencies loaded by: gateway-server.js, index.js, agent-server.js
```

### TypeScript Configuration Hierarchy
```
tsconfig.json (base)
├── Extended by:
│   ├── tsconfig.client.json (client/)
│   ├── tsconfig.server.json (server/)
│   └── tsconfig.agent.json (server/agent/)
└── Used by: Compilation, IDE type checking
```

### Database Configuration
```
drizzle.config.js
├── Used by: drizzle-kit (migrations)
├── Reads: DATABASE_URL from mono-mode.env
└── Generates: drizzle/ directory (migration files)
```

### Build Tools
```
vite.config.js
├── Used by: Vite (client build)
├── Imports: @vitejs/plugin-react
└── Output: client/dist/
```

```
tailwind.config.js
├── Used by: Tailwind CSS
├── Scans: client/src/**/*.{ts,tsx}
└── Output: Embedded in Vite build
```

```
postcss.config.js
├── Used by: Vite (CSS processing)
└── Plugins: tailwindcss, autoprefixer
```

### Test Configuration
```
jest.config.js
├── Used by: npm run test:blocks
└── Tests: tests/*.test.js

playwright.config.ts
├── Used by: npx playwright test
└── Tests: tests/e2e/*.spec.ts
```

---

## 🚀 Server Entry Points

### Main Gateway (Production)
```
gateway-server.js
├── Mode: MONO (unified server)
├── Port: 5000 (forwarded to 80/443)
├── Mounts:
│   ├── SDK routes (via sdk-embed.js)
│   ├── Agent routes (via server/agent/embed.js)
│   └── SSE events (via server/strategy-events.js)
├── Spawns (if ENABLE_BACKGROUND_WORKER=true):
│   └── strategy-generator.js
└── Serves: client/dist (SPA)
```

### SDK Server (Standalone Mode - Deprecated)
```
index.js
├── Mode: Split (standalone SDK)
├── Port: 3102 (SDK_PORT/EIDOLON_PORT)
├── Status: Used only in split mode (APP_MODE=split)
└── Health: GET /, /health, /ready
```

### Agent Server (Standalone Mode - Deprecated)
```
agent-server.js
├── Mode: Split (standalone Agent)
├── Port: 43717 (AGENT_PORT)
├── Status: Used only in split mode (APP_MODE=split)
└── Provides: File system, shell, DB operations
```

### Background Worker
```
strategy-generator.js
├── Spawned by: gateway-server.js (in production)
├── Purpose: Strategy consolidation listener
├── Listens to: PostgreSQL NOTIFY events
└── Process: Independent background worker
```

### Deployment Variants
```
deploy-entry.js
├── Purpose: Ultra-fast health-only server
├── Use case: Autoscale mode (Cloud Run)
└── Status: Minimal HTTP server (no Express)

health-server.js
├── Purpose: Minimal health server
├── Use case: Testing autoscale health checks
└── Status: Responds OK to all requests
```

---

## 📚 Documentation Files

### Core Documentation
```
README.md
├── Audience: GitHub, new developers
├── Links to: docs/ directory
└── Status: Main project overview

replit.md
├── Audience: Replit AI, Replit users
├── Purpose: AI-readable system overview
└── Contains: Architecture, model config, preferences
```

### Status Reports
```
DEPLOYMENT_READY.md
├── Purpose: Production readiness checklist
└── Updated: Post-deployment verification

FIELD_TEST_READY.md
├── Purpose: User acceptance test readiness
└── Updated: After integration testing

IMPLEMENTATION_SUMMARY.md
├── Purpose: Feature completion tracking
└── Updated: After major milestones

VICTORY_REPORT.md
├── Purpose: Final deployment success summary
└── Updated: Post-production launch
```

### Technical Documentation
```
HEALTH_CHECK_VERIFICATION.md
├── Purpose: Cloud Run health check compliance
└── Related: deploy-entry.js, health-server.js

LOCATION_AGNOSTIC_VERIFIED.md
├── Purpose: Global location support verification
└── Related: server/lib/geocoding.js

STRATEGY_PIPELINE_TEST_GUIDE.md
├── Purpose: Testing strategy generation
└── Related: server/lib/providers/
```

---

## 🛠️ Shell Scripts

### Startup Scripts
```
start-mono.sh
├── Purpose: Start app in MONO mode
├── Loads: mono-mode.env, .env
├── Starts: gateway-server.js + strategy-generator.js
└── Readiness: Polls /ready endpoint

start-mono-fixed.sh
├── Purpose: Cloud Run optimized startup
├── Builds: client/dist (if missing)
└── Exec: gateway-server.js (foreground)

start-clean.sh
├── Purpose: Kill zombies + clean start
├── Kills: Processes on PORT 5000
└── Runs: npm run start:replit

start-vecto.sh
├── Purpose: Legacy startup (deprecated)
└── Status: Replaced by start-mono.sh

start-workflow.sh
├── Purpose: Multi-service orchestration
├── Starts: SDK (3101) + Agent (43717) + Gateway (80)
└── Status: For split mode only
```

### Testing Scripts
```
run-all.sh
├── Purpose: Run all test suites
└── Executes: Jest + Playwright + smoke tests

run-full-validation.sh
├── Purpose: Complete system validation
└── Includes: Schema, API, health checks

validate-system.sh
├── Purpose: Pre-deployment validation
└── Checks: Database, models, env vars

test-startup.sh
├── Purpose: Startup reliability test
└── Verifies: Port binding, health endpoints
```

---

## 🧪 Test Files

### Integration Tests
```
test-global-scenarios.js
├── Purpose: End-to-end workflow testing
├── Tests: GPS → Snapshot → Strategy → Blocks
└── Output: docs/global-test-results-*.md

test-database-fixes.js
├── Purpose: Database schema validation
└── Verifies: Foreign keys, RLS, triggers

test-event-research.js
├── Purpose: Perplexity event enrichment
└── Verifies: Event matching, proximity boost
```

### Component Tests
```
test-perplexity.js
├── Purpose: Perplexity API integration
└── Tests: Research briefing generation

test-sse.js
├── Purpose: Server-Sent Events
└── Tests: Strategy ready notifications

test-verification.sh
├── Purpose: Quick smoke test
└── Verifies: All services responding
```

---

## 🔌 Integration Files

### SDK Embedding
```
sdk-embed.js
├── Purpose: Embed SDK routes in gateway
├── Imported by: gateway-server.js (MONO mode)
└── Mounts: /api/* routes
```

### AI Configuration
```
agent-ai-config.js
├── Purpose: Model configuration
├── Exports: GATEWAY_CONFIG
└── Used by: gateway-server.js

models-dictionary.json
├── Purpose: Model metadata
└── Used by: server/lib/models-dictionary.js
```

### Extension Configuration
```
extension.json
├── Purpose: Replit Extension metadata
└── Status: Experimental feature
```

---

## 📊 Data Files

### Configuration Data
```
payload.json
├── Purpose: Test payload examples
└── Used by: Manual API testing

models-dictionary.json
├── Purpose: AI model metadata
└── Structure: {provider: {model: {capabilities}}}
```

### Python Configuration
```
pyproject.toml
├── Purpose: Python project metadata
└── Status: Minimal (not actively used)

uv.lock
├── Purpose: Python dependency lock
└── Status: Generated by uv package manager
```

---

## 🔗 Relationship Summary

### Critical Dependency Chain
```
.replit
  → scripts/start-replit.js
    → mono-mode.env (loaded)
    → gateway-server.js (started)
      → agent-ai-config.js (imported)
      → sdk-embed.js (imported)
      → server/agent/embed.js (imported)
      → strategy-generator.js (spawned)
      → client/dist (served)
```

### Configuration Loading Order
```
1. .replit (shell loads mono-mode.env)
2. scripts/start-replit.js (Node.js loads .env via dotenv)
3. gateway-server.js (reads process.env)
4. agent-ai-config.js (reads process.env)
5. sdk-embed.js (inherits from gateway)
```

### Build Process Flow
```
npm run build:client
  → vite.config.js
    → tailwind.config.js
      → postcss.config.js
        → client/dist/ (output)
```

### Database Migration Flow
```
npm run db:push
  → drizzle.config.js
    → shared/schema.js
      → drizzle/meta/ (snapshots)
        → drizzle/*.sql (migrations)
          → Database (applied)
```

### Testing Flow
```
npm run test:blocks
  → jest.config.js
    → tests/blocksApi.test.js
      → snapshots/ (fixtures)

npx playwright test
  → playwright.config.ts
    → tests/e2e/copilot.spec.ts
      → client/dist/ (SPA)
```

---

## 🚨 Deprecated Files

**Do Not Use:**
- `start-vecto.sh` - Use `start-mono.sh`
- `vecto-start.sh` - Use `start-mono.sh`
- `.replit.workflows.json` - Use `.replit`
- `index.js` (standalone) - Use gateway-server.js MONO mode
- `agent-server.js` (standalone) - Use gateway-server.js MONO mode

---

## 🎯 Quick Reference

**Start the app:**
```bash
npm run start:replit  # Uses .replit → scripts/start-replit.js
```

**Build client:**
```bash
npm run build:client  # Uses vite.config.js
```

**Run tests:**
```bash
npm run test:blocks   # Uses jest.config.js
npx playwright test   # Uses playwright.config.ts
```

**Deploy:**
```bash
npm run db:push       # Uses drizzle.config.js
# Then Run button → gateway-server.js starts
```

---

**End of Root Files Map**
