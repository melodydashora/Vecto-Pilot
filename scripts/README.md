# Workflow Log Capture Scripts

## Overview

These scripts capture comprehensive logs during workflow execution, from workflow refresh through smartblocks landing and completion.

## Scripts

### 1. `capture-workflow-logs.js` - Main Capture Script

Monitors and logs:
- Workflow startup/restart events
- HTTP requests and responses  
- Database operations (queries, inserts, updates)
- LLM triad pipeline execution
- Frontend smartblocks rendering

**Output:** `logs/workflow-capture.log` (overwrites on each run)

**Usage:**
```bash
node scripts/capture-workflow-logs.js
```

**Duration:** 120 seconds (configurable via `CAPTURE_DURATION_MS`)

### 2. `enhanced-db-logger.js` - Database Operation Logger

Middleware for logging database operations with timing and row counts.

**Usage in routes:**
```javascript
import { loggedQuery } from '../scripts/enhanced-db-logger.js';

// Wrap database queries
const snapshots = await loggedQuery(
  () => db.select().from(snapshotsTable).where(eq(snapshotsTable.id, snapshotId)),
  'SELECT',
  'snapshots',
  `Fetching snapshot ${snapshotId}`
);
```

### 3. `test-workflow-capture.sh` - Test Runner

Automated test script that:
1. Starts log capture
2. Triggers workflow refresh
3. Waits for completion
4. Displays summary

**Usage:**
```bash
./scripts/test-workflow-capture.sh
```

## Log File Format

```
[2025-10-08T20:00:00.000Z] [SECTION] Message
{
  "data": "optional structured data"
}
```

**Sections:**
- `[INIT]` - Script initialization/shutdown
- `[WORKFLOW]` - Workflow state changes
- `[DATABASE]` - Database operations
- `[TRIAD]` - LLM pipeline execution
- `[BLOCKS]` - Smartblocks generation
- `[HTTP]` - HTTP requests
- `[ERROR]` - Error messages
- `[WARN]` - Warning messages
- `[STATUS]` - Workflow status checks

## Integration with Existing Code

To add database logging to your routes, import and use the logger:

```javascript
// In server/routes/blocks.js or similar
import { loggedQuery } from '../scripts/enhanced-db-logger.js';

// Replace direct db calls:
// const result = await db.select()...

// With logged queries:
const result = await loggedQuery(
  () => db.select().from(table).where(...),
  'SELECT',
  'table_name',
  'Description of operation'
);
```

## Output Example

```
[2025-10-08T20:00:00.000Z] [INIT] ========================================
[2025-10-08T20:00:00.000Z] [INIT] WORKFLOW LOG CAPTURE STARTED
[2025-10-08T20:00:01.234Z] [WORKFLOW] Eidolon SDK starting...
[2025-10-08T20:00:02.345Z] [DATABASE] SELECT Query
{
  "query": "SELECT * FROM snapshots WHERE id = $1",
  "params": "1 params"
}
[2025-10-08T20:00:02.456Z] [DATABASE] SELECT Result: 1 rows (111ms)
[2025-10-08T20:00:05.678Z] [TRIAD] Step 1/3: Starting Claude strategist
[2025-10-08T20:00:15.789Z] [TRIAD] Strategy received
[2025-10-08T20:00:16.890Z] [BLOCKS] 6 blocks returned
[2025-10-08T20:00:16.900Z] [STATUS] ✅ WORKFLOW CYCLE COMPLETE
```

## Troubleshooting

**No logs captured:**
- Ensure the workflow is running
- Check that the script has permissions: `chmod +x scripts/*.sh scripts/*.js`
- Verify logs directory exists: `mkdir -p logs`

**Database logs missing:**
- Import and use `loggedQuery` wrapper in your route handlers
- Check that database operations are happening during capture window

**Script exits early:**
- Increase `CAPTURE_DURATION_MS` in capture-workflow-logs.js
- Check for process errors in console output
