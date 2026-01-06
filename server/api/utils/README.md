> **Last Verified:** 2026-01-06

# API Utilities (`server/api/utils/`)

## Purpose

Shared utility functions for API routes.

## Files

| File | Purpose |
|------|---------|
| `http-helpers.js` | HTTP response helpers, JSON parsing |
| `safeElapsedMs.js` | Safe timing utilities |

## http-helpers.js

```javascript
import { safeJsonParse, isPlusCode } from './http-helpers.js';

// Parse JSON with fallback
const data = safeJsonParse(jsonString, defaultValue);

// Check if string is Google Plus Code
if (isPlusCode(locationString)) { ... }
```

## safeElapsedMs.js

```javascript
import { safeElapsedMs } from './safeElapsedMs.js';

const start = Date.now();
// ... operation ...
const elapsed = safeElapsedMs(start); // Returns "123ms" or "N/A"
```

## Connections

- **Imported by:** Various route files and lib modules

## Import Paths

```javascript
// From server/api/*/ (route files in subfolders)
import { safeJsonParse, isPlusCode } from '../utils/http-helpers.js';
import { safeElapsedMs } from '../utils/safeElapsedMs.js';

// From server/lib/*/ (NOT recommended - prefer putting in lib/infrastructure/)
import { safeElapsedMs } from '../api/utils/safeElapsedMs.js';
```

**Note:** From `server/api/*/` subfolders, use `../utils/` (not `./utils/`).
