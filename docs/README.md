# Documentation

## Architecture

Detailed technical documentation split by domain:

| Document | Purpose |
|----------|---------|
| [API Reference](architecture/api-reference.md) | Complete API endpoint documentation |
| [Authentication](architecture/authentication.md) | JWT auth, login, registration flow |
| [Database Schema](architecture/database-schema.md) | PostgreSQL tables and relationships |
| [AI Pipeline](architecture/ai-pipeline.md) | TRIAD architecture and model configuration |
| [Event Discovery](architecture/event-discovery.md) | Multi-model AI event search system |
| [Constraints](architecture/constraints.md) | Critical rules and limitations |
| [Google Cloud APIs](architecture/google-cloud-apis.md) | Google APIs reference and usage patterns |
| [Client Structure](architecture/client-structure.md) | Frontend architecture |
| [Server Structure](architecture/server-structure.md) | Backend architecture |
| [Decisions](architecture/decisions.md) | Architecture decision log |

## Additional Documentation

| Document | Purpose |
|----------|---------|
| [AI Partnership Plan](AI_PARTNERSHIP_PLAN.md) | Documentation improvement roadmap |
| [API Routes Registry](api-routes-registry.md) | Complete API route listing |
| [Event Freshness & TTL](EVENT_FRESHNESS_AND_TTL.md) | Event caching and freshness rules |
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
