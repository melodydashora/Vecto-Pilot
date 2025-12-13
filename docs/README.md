# Documentation

## Architecture

Detailed technical documentation split by domain:

| Document | Purpose |
|----------|---------|
| [API Reference](architecture/api-reference.md) | Complete API endpoint documentation |
| [Database Schema](architecture/database-schema.md) | PostgreSQL tables and relationships |
| [AI Pipeline](architecture/ai-pipeline.md) | TRIAD architecture and model configuration |
| [Constraints](architecture/constraints.md) | Critical rules and limitations |
| [Google Cloud APIs](architecture/google-cloud-apis.md) | Google APIs reference and usage patterns |

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
- [client/src/components/](../client/src/components/README.md) - UI components
- [client/src/hooks/](../client/src/hooks/README.md) - Custom hooks
- [client/src/contexts/](../client/src/contexts/README.md) - React contexts

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
