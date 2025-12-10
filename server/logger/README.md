# Logger (`server/logger/`)

## Purpose

Structured NDJSON logging for server operations. Outputs newline-delimited JSON for easy parsing by log aggregators.

## Files

| File | Purpose | Export |
|------|---------|--------|
| `ndjson.js` | Structured JSON logging | `ndjson(type, data)` |

## Usage

```javascript
import { ndjson } from '../../logger/ndjson.js';

// Log events with structured data
ndjson('snapshot.req', { cid: correlationId, path: '/snapshot' });
ndjson('health.ok', {});
ndjson('error', { message: 'Something failed', stack: error.stack });
```

## Output Format

Each log line is a JSON object:
```json
{"ts":"2025-12-10T04:05:06.123Z","type":"snapshot.req","cid":"uuid","path":"/snapshot"}
```

Fields:
- `ts` - ISO timestamp (auto-added)
- `type` - Event type (first argument)
- `...data` - Any additional fields (spread from second argument)

## Import Paths

```javascript
// From server/api/*/
import { ndjson } from '../../logger/ndjson.js';

// From server/lib/*/
import { ndjson } from '../logger/ndjson.js';

// Dynamic import (same paths apply)
const { ndjson } = await import('../../logger/ndjson.js');
```

## Connections

- **Used by:** `server/api/health/health.js`, `server/api/location/location.js`, and other routes
- **Related:** `server/lib/infrastructure/` may contain additional logging utilities
