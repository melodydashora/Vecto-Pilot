# Eidolon Tools (`server/eidolon/tools/`)

## Purpose

Diagnostic and database tools for the Eidolon Enhanced SDK.

## Files

| File | Purpose |
|------|---------|
| `mcp-diagnostics.js` | MCP (Model Context Protocol) server diagnostics and repair |
| `sql-client.ts` | SQL query client for Eidolon database operations |

## MCP Diagnostics

Scans and validates MCP server configurations:

```javascript
import MCPDiagnostics from './mcp-diagnostics.js';

const diagnostics = new MCPDiagnostics(projectRoot);
await diagnostics.scanMCPConfiguration();
```

**Checks for:**
- `.replit-assistant-override.json`
- `mcp-config.json`
- `server-config.json`

## SQL Client

Type-safe database query client:

```typescript
import { SQLClient } from './sql-client';

const client = new SQLClient();
const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
```

## Connections

- **Uses:** `../../db/pool.js` for shared database connection
- **Used by:** Eidolon core for workspace operations
