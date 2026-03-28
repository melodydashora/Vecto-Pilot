> **Last Verified:** 2026-02-25

# Config Module (`server/config/`)

## Purpose

Server configuration: environment loading, validation, and runtime settings.

## Files

| File | Purpose |
|------|---------|
| `load-env.js` | Environment loading: GCP credential reconstruction + .env.local |
| `validate-env.js` | Environment validation (required API keys, strategy model config) |
| `env-registry.js` | Environment variable registry with defaults and types |
| `holiday-override.json` | Manual holiday override configuration |
| `agent-policy.json` | Agent system policy |
| `assistant-policy.json` | Assistant system policy |
| `eidolon-policy.json` | Eidolon system policy |

## Usage

### Environment Loading
```javascript
import { loadEnvironment } from './server/config/load-env.js';

loadEnvironment();
// 1. Reconstructs GCP credentials from Replit Secrets
// 2. In deployment: uses Replit Secrets only (skips file loading)
// 3. In dev: loads .env.local as baseline
```

### Environment Validation
```javascript
import { validateOrExit } from './server/config/validate-env.js';

validateOrExit(); // Validates env + strategy models, exits on fatal errors
```

## Required Environment Variables

### Core
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (default: 5000)

### API Keys
- `ANTHROPIC_API_KEY` - Claude API
- `OPENAI_API_KEY` - GPT-5.2 API
- `GEMINI_API_KEY` - Gemini API
- `GOOGLE_MAPS_API_KEY` - Google Maps/Places/Routes

### Strategy Models
```bash
STRATEGY_STRATEGIST=claude-opus-4-6
STRATEGY_BRIEFER=gemini-3.1-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.4
STRATEGY_EVENT_VALIDATOR=claude-opus-4-6
```

## Holiday Override System

`holiday-override.json` allows manual holiday banners:

```json
{
  "active": true,
  "overrides": [{
    "id": "happy-holidays-2024",
    "holiday_name": "Happy Holidays",
    "start_date": "2024-12-01T00:00:00Z",
    "end_date": "2025-01-02T23:59:59Z",
    "superseded_by_actual": true
  }]
}
```

Manage via CLI:
```bash
node server/scripts/holiday-override.js list
node server/scripts/holiday-override.js add "Happy Holidays" "2024-12-01" "2025-01-02"
node server/scripts/holiday-override.js remove <id>
node server/scripts/holiday-override.js test
```

## Connections

- **Loaded by:** `gateway-server.js` (first import)
- **Used by:** All server modules that need env vars

## Import Paths

```javascript
// From gateway-server.js (project root)
import { loadEnvironment } from './server/config/load-env.js';
import { validateOrExit } from './server/config/validate-env.js';

// From server/lib/*/
import holidayOverrides from '../../config/holiday-override.json' assert { type: 'json' };

// Reading policy files
const policy = await import('../../config/agent-policy.json', { assert: { type: 'json' } });
```
