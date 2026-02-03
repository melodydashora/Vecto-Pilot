# Pre-flight: Code Style

Quick reference for code conventions. Read before writing new code.

## Unused Variables

Prefix with underscore:

```javascript
// CORRECT
const [_unused, setUsed] = useState();
function handler(_event) { }

// WRONG - lint error
const [unused, setUsed] = useState();
```

## TypeScript

- **Client:** Strict mode enabled
- **Server:** JavaScript with JSDoc types

## Import Patterns

```javascript
// Server - AI adapters
import { callModel } from '../../lib/ai/adapters/index.js';

// Server - Database
import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';

// Server - Logging
import { triadLog, venuesLog } from '../../logger/workflow.js';

// Client - Components
import { Button } from '@/components/ui/button';

// Client - Hooks
import { useStrategy } from '@/hooks/useStrategy';
```

## Logging Conventions

Use workflow logger, not console.log:

```javascript
// CORRECT - Use role names
triadLog.phase(1, `Starting for ${snapshotId.slice(0, 8)}`);
venuesLog.done(2, `5 venues enriched`, 348);

// WRONG - Model names, console.log
console.log(`[Claude] Starting...`);
```

## Check Before Editing

- [ ] Are unused variables prefixed with `_`?
- [ ] Am I using workflow logger, not console.log?
- [ ] Am I following the import patterns for this area?
- [ ] Did I grep for existing implementations first?

## Before Creating Files

1. Check folder README for existing files
2. Search: `grep -r "functionName" server/`
3. Check LESSONS_LEARNED.md for known issues
