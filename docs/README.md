> **Last Verified:** 2026-01-06

# Documentation

## Folder Structure

| Folder | Purpose |
|--------|---------|
| [architecture/](architecture/README.md) | Technical architecture docs (21 documents) |
| [ai-tools/](ai-tools/README.md) | AI-powered tools documentation |
| [memory/](memory/README.md) | Memory layer and session logs |
| [preflight/](preflight/README.md) | Pre-flight check cards (<50 lines each) |
| [review-queue/](review-queue/README.md) | Automated change analysis (pending items) |
| [reviewed-queue/](reviewed-queue/README.md) | Completed reviews with extracted rules |
| [melswork/](melswork/README.md) | Owner-maintained documentation |

## Architecture Documentation

Detailed technical documentation split by domain. See [architecture/README.md](architecture/README.md) for full index.

| Document | Purpose |
|----------|---------|
| [API Reference](architecture/api-reference.md) | Complete API endpoint documentation |
| [Authentication](architecture/authentication.md) | JWT auth, login, registration flow |
| [Database Schema](architecture/database-schema.md) | PostgreSQL tables and relationships |
| [AI Pipeline](architecture/ai-pipeline.md) | TRIAD architecture and model configuration |
| [AI Coach](architecture/ai-coach.md) | AI Coach system architecture |
| [Event Discovery](architecture/event-discovery.md) | Multi-model AI event search system |
| [Constraints](architecture/constraints.md) | Critical rules and limitations |
| [Google Cloud APIs](architecture/google-cloud-apis.md) | Google APIs reference and usage patterns |
| [Client Structure](architecture/client-structure.md) | Frontend architecture |
| [Server Structure](architecture/server-structure.md) | Backend architecture |
| [Decisions](architecture/decisions.md) | Architecture decision log |

## Additional Files

| Document | Purpose |
|----------|---------|
| [AI Partnership Plan](AI_PARTNERSHIP_PLAN.md) | Documentation improvement roadmap |
| [API Routes Registry](api-routes-registry.md) | Complete API route listing |
| [Checkpoint AI Partnership](CHECKPOINT_AI_PARTNERSHIP.md) | Partnership progress checkpoint |
| [Database Schema (Detailed)](DATABASE_SCHEMA.md) | Comprehensive schema dump |
| [Data Flow Map](DATA_FLOW_MAP.json) | JSON data flow mapping |
| [Doc Discrepancies](DOC_DISCREPANCIES.md) | Known documentation discrepancies |
| [Event Freshness & TTL](EVENT_FRESHNESS_AND_TTL.md) | Event caching and freshness rules |
| [Mismatched](MISMATCHED.md) | Identified mismatches |
| [Monthly Review Checklist](MONTHLY_REVIEW_CHECKLIST.md) | Documentation maintenance checklist |

## Quick Links

### Folder Documentation
Every folder has a README explaining its purpose. Start here:

**Server:**
- [server/api/](../server/api/README.md) - API routes by domain
- [server/lib/](../server/lib/README.md) - Business logic
- [server/config/](../server/config/README.md) - Configuration
- [server/middleware/](../server/middleware/README.md) - Middleware
- [server/bootstrap/](../server/bootstrap/README.md) - Startup
- [server/jobs/](../server/jobs/README.md) - Background workers

**Client:**
- [client/src/](../client/src/README.md) - Frontend overview
- [client/src/pages/](../client/src/pages/README.md) - Page components (auth, co-pilot)
- [client/src/layouts/](../client/src/layouts/README.md) - Layout components (CoPilotLayout)
- [client/src/contexts/](../client/src/contexts/README.md) - React contexts (auth, location, co-pilot)
- [client/src/components/](../client/src/components/README.md) - UI components
- [client/src/hooks/](../client/src/hooks/README.md) - Custom hooks

### Key Files

| File | Purpose |
|------|---------|
| [CLAUDE.md](../CLAUDE.md) | AI assistant instructions |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Complete system overview |
| [LESSONS_LEARNED.md](../LESSONS_LEARNED.md) | Historical issues and fixes |
| [REORGANIZATION_PLAN.md](../REORGANIZATION_PLAN.md) | Codebase organization status |

## Development

```bash
# Start development server
npm run dev

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Run tests
npm run test

# Pre-PR checklist
npm run lint && npm run typecheck && npm run build
```
