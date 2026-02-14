> **Last Verified:** 2026-01-06

# Config Module (`server/config/`)

## Purpose

Server configuration: environment loading, validation, and runtime settings.

## Files

| File | Purpose |
|------|---------|
| `load-env.js` | Environment loading (mode-specific .env files) |
| `validate-env.js` | Environment validation (required API keys) |
| `validate-strategy-env.js` | Strategy model configuration validation |
| `env-registry.js` | Environment variable registry with defaults and types |
| `holiday-override.json` | Manual holiday override configuration |
| `agent-policy.json` | Agent system policy |
| `assistant-policy.json` | Assistant system policy |
| `eidolon-policy.json` | Eidolon system policy |

## Usage

### Environment Loading
```javascript
import './config/load-env.js'; // First import in gateway-server.js

// Loads in order:
// 1. .env.shared (common settings)
// 2. .env.{mode} (mode-specific settings)
// 3. .env (local overrides)
```

### Environment Validation
```javascript
import { validateEnv } from './config/validate-env.js';

validateEnv(); // Throws if required vars missing
```

### Strategy Validation
```javascript
import { validateStrategyEnv } from './config/validate-strategy-env.js';

validateStrategyEnv(); // Validates AI model configuration
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
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.2
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
import './server/config/load-env.js';  // MUST be first import
import { validateEnv } from './server/config/validate-env.js';
import { validateStrategyEnv } from './server/config/validate-strategy-env.js';

// From server/lib/*/
import holidayOverrides from '../../config/holiday-override.json' assert { type: 'json' };

// Reading policy files
const policy = await import('../../config/agent-policy.json', { assert: { type: 'json' } });
```
