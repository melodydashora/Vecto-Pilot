# Archived Files

This directory contains deprecated code, old test files, and export artifacts that are no longer used in production.

## Files Archived (Nov 15, 2025)

### Empty/Dead Files
- **Node.js** - 0-byte empty file (deleted, not archived)

### Test Scripts (Not Used in Production)
- `test-database-fixes.js` - Database testing script
- `test-event-research.js` - Event enrichment testing
- `test-global-scenarios.js` - Global scenario testing
- `test-perplexity.js` - Perplexity API testing
- `test-sse.js` - Server-Sent Events testing

### Deprecated Scripts
- `check-api.js` - Old API validation script
- `deploy-entry.js` - Legacy deployment entry point (replaced by contract-driven env system)
- `health-server.js` - Standalone health server (replaced by gateway-embedded health routes)

### Export Artifacts
- `gpt5-agent-package/` - GPT-5 agent package export (not needed for runtime)

## Active Files (DO NOT ARCHIVE)

These files are actively used in production:

- **agent-ai-config.js** - Imported by gateway-server.js (line 161) - Provides unified AI configuration
- **sdk-embed.js** - Imported by gateway-server.js (line 192) - Mounts all API routes
- **gateway-server.js** - Main entry point for gateway service
- **strategy-generator.js** - Background worker for strategy generation
- **mono-mode.env** - Fallback environment config for local development

## Environment Contract System

The project now uses a contract-driven environment system:
- `env/shared.env` - Common variables
- `env/webservice.env` - Autoscale webservice mode
- `env/worker.env` - Background worker mode
- `mono-mode.env` - Legacy fallback (local development)

## TypeScript Configs (Keep All)

Multiple tsconfig files are **normal** for TypeScript monorepos:
- `tsconfig.base.json` - Base configuration
- `tsconfig.client.json` - Frontend config
- `tsconfig.server.json` - Backend config
- `tsconfig.agent.json` - Agent service config
- `tsconfig.json` - Root config

These are NOT duplicates - they're part of the project references architecture.
