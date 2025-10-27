# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview

Vecto Pilot is an AI-powered rideshare intelligence platform designed for drivers in the Dallas-Fort Worth metropolitan area. The system provides real-time strategic briefings combining location intelligence, venue events, traffic conditions, weather, and air quality data to optimize driver earnings. It uses a multi-AI pipeline (Claude for strategy, GPT-5 for planning, Gemini for validation) to deliver contextual insights through a React-based web interface.

The platform operates as a full-stack Node.js application with three core services: a Gateway server (port 80/5000), an SDK server (port 3101), and an Agent server (port 43717). The architecture supports both monolithic ("mono") and split deployment modes, with the gateway coordinating all traffic routing, WebSocket connections, and static asset serving.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Multi-Service Architecture

**Gateway Server** (`gateway-server.js`)
- Entry point for all client traffic (HTTP and WebSocket)
- Runs on port 80 (production) or 5000 (development)
- Routes `/api/*` requests to SDK server on port 3101
- Routes `/agent/*` requests to Agent server on port 43717
- Serves React SPA from `dist/` or proxies to Vite dev server on port 5173
- Implements HTML kill-switch: returns 502 JSON error if API endpoints leak HTML responses
- Manages child process supervision in split mode
- Enforces strict route ordering: API proxies before static/Vite middleware

**SDK Server** (`index.js`, `sdk-embed.js`)
- Business logic layer on port 3101
- Provides REST API endpoints for location services, venue intelligence, weather, air quality
- Handles snapshot creation and ML data pipeline
- Mounts enhanced memory middleware for context awareness
- Route prefix stripping: expects `/api` stripped by gateway, mounts routes like `/location/*` directly
- Embeddable via `sdk-embed.js` for mono mode deployment

**Agent Server** (`agent-server.js`)
- Workspace intelligence layer on port 43717
- Provides file system operations, shell command execution, database access
- Security-hardened with path traversal protection, command whitelisting, rate limiting
- Token-based authentication via `AGENT_TOKEN` environment variable
- Capability-based access control using `capsFromEnv()` and `bearer()` auth
- WebSocket support at `/agent/ws` for real-time communication

### AI Configuration

All AI services (Agent, Eidolon, Assistant, Gateway) use unified parameters defined in `agent-ai-config.js`:
- **Model**: extended-thinking (GPT-5 equivalent)
- **Temperature**: 0.0 (deterministic outputs)
- **Top-p**: 0.9
- **Max tokens**: 4096
- **Reasoning depth**: deep
- **Chain of thought**: structured
- **Hallucination guard**: strict
- **Execution mode**: evidence_first

The three-stage AI pipeline for strategic analysis:
1. **Claude Sonnet 4.5** (Strategist): Strategic analysis and pro tips, 64K token context
2. **GPT-5** (Planner): Deep reasoning for venue selection and tactical planning
3. **Gemini** (Validator): Output validation and quality assurance

Model configurations are centralized in `models-dictionary.json` with cost tracking and capability definitions.

### Frontend Architecture

**React + TypeScript SPA**
- Built with Vite (config: `vite.config.js`)
- Radix UI component library for accessible UI primitives
- TailwindCSS for styling (`tailwind.config.js`)
- React Query (`@tanstack/react-query`) for server state management
- Client source in `client/src/`, shared types in `shared/`
- Path aliases: `@/` → client source, `@shared/` → shared types
- Development server on port 5173, production build served from `dist/`

### Data Storage

**PostgreSQL Database**
- Connection pooling via `server/db/pool.js` with `getSharedPool()` singleton
- Schema management with Drizzle ORM (`drizzle.config.js`, `shared/schema.js`)
- Tables for snapshots, strategies, venue events, ML training data
- Enhanced memory systems:
  - `cross_thread_memory`: System-wide state across requests
  - `eidolon_memory`: Agent-scoped session state
  - `assistant_memory`: User preferences and conversation history
- SQL helper functions for JWT claims: `app.jwt_sub()`, `app.jwt_tenant()`, `app.jwt_role()`, `app.is_authenticated()`

**Memory Systems** (`server/agent/`)
- Thread context manager for request correlation
- Enhanced project context with method, path, IP, user agent tracking
- Cross-thread memory storage with TTL (7 days default)
- Agent-scoped memory for per-service state
- Conversation history tracking for adaptive behavior

### Authentication & Security

**JWT with RS256 Asymmetric Keys**
- RSA-2048 keypair in `keys/` directory (private.pem, public.pem)
- JWKS endpoint at `public/.well-known/jwks.json`
- Token signing script: `scripts/sign-token.mjs`
- 15-minute token expiry with 90-day key rotation schedule
- Claims: sub (user_id), tenant_id, role, iss, aud

**Security Middleware** (`server/middleware/security.js`)
- Rate limiting: 200 requests per 15 minutes (general), stricter limits for auth endpoints
- CORS with configurable allowlist
- Helmet.js for security headers
- Trust proxy configuration for Replit deployment
- Path traversal protection in agent server
- File size limits (10MB) for uploads

### API Structure

**Location Services** (`/api/location/*`)
- `/resolve`: Geocoding and timezone resolution
- `/snapshot`: Create location snapshot with ML data pipeline
- `/geocode/reverse`, `/geocode/forward`: Address resolution
- `/timezone`, `/weather`, `/airquality`: Environmental data

**Venue Intelligence** (`/api/venue/*`, `/api/blocks/*`)
- Venue search and discovery
- Event research with Perplexity API integration
- Smart blocks strategy generation
- Venue event summaries with impact levels

**Diagnostics & Health** (`/api/diagnostics/*`, `/healthz`, `/ready`)
- Memory diagnostics endpoints
- Service health checks
- Job metrics tracking
- ML health dashboard

**Agent Capabilities** (`/agent/*`)
- File system: `/fs/read`, `/fs/write`, `/fs/list`
- Shell execution: `/shell/exec`
- Database queries: `/sql/query`
- Memory operations: `/memory/get`, `/memory/put`
- Workspace diagnostics and architectural review

### Deployment Modes

**Mono Mode** (Single Process)
- Gateway embeds SDK and Agent as Express middleware
- Single port exposure (5000)
- Simplified for Replit deployments
- Configured via `APP_MODE=mono`

**Split Mode** (Multi-Process)
- Gateway spawns SDK and Agent as child processes
- Process supervision with health monitoring
- Separate log streams per service
- Configured via `APP_MODE=gateway`

### Build & Development

**Scripts** (`package.json`)
- `npm run dev`: Development mode with hot reload
- `npm run build`: Production build (Vite compilation)
- `npm run db:push`: Drizzle migrations
- `npm test:phases`: Run all test phases
- `npm run model:verify`: Validate AI model configurations

**TypeScript Configuration**
- Multi-project setup via `tsconfig.json` with references
- Client: `tsconfig.client.json` (React, DOM, Vite)
- Server: `tsconfig.server.json` (Node, CommonJS/ESM)
- Agent: `tsconfig.agent.json` (Extension SDK)

## External Dependencies

### Third-Party APIs

**AI & Research Services**
- **Anthropic API**: Claude Sonnet 4.5 for strategic analysis (`@anthropic-ai/sdk`)
- **OpenAI API**: GPT-5 for deep reasoning and planning
- **Google Gemini API**: Validation layer (`@google/generative-ai`)
- **Perplexity API**: Real-time internet research for venue events, flight disruptions

**Location & Mapping**
- **Google Maps API**: Geocoding, timezone, places (`@googlemaps/js-api-loader`)
- Weather and air quality data services (API keys via environment variables)

**Environment Variables Required**
- `ANTHROPIC_API_KEY`: Claude API access
- `OPENAI_API_KEY`: GPT-5 API access
- `GOOGLE_API_KEY` or `GEMINI_API_KEY`: Gemini API access
- `PERPLEXITY_API_KEY`: Research API access
- `DATABASE_URL`: PostgreSQL connection string
- `AGENT_TOKEN`: Agent server authentication (auto-generated if missing)

### Database

**PostgreSQL** (via Replit or external provider)
- Drizzle ORM for schema management and queries
- Connection pooling with `pg` library
- Vector database support for embeddings
- Row-Level Security (RLS) toggle scripts in `scripts/toggle-rls.js`

### Infrastructure

**Replit Platform**
- Deployment via Replit deployments (port 80 mapped from internal 5000)
- Nix environment for dependencies
- `.replit` workflow configuration for multi-service startup
- Extension API support (`@replit/extensions`) for workspace integration

**Process Management**
- Child process spawning via Node.js `child_process`
- HTTP proxy via `http-proxy` library
- WebSocket proxying for real-time features
- Graceful shutdown handling with SIGTERM/SIGINT

### Frontend Libraries

**UI Components**
- Radix UI primitives (20+ components: Dialog, Popover, Tabs, etc.)
- Chart.js for data visualization
- React Hook Form with Zod validation (`@hookform/resolvers`)

**State Management**
- React Query for server state
- Context API for client state
- Local storage for preferences

**Development Tools**
- Vite for bundling and dev server
- ESLint for code quality
- TypeScript for type safety
- PostCSS with Autoprefixer and TailwindCSS