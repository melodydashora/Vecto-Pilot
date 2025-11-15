# Query Conventions - Snapshot and Strategy Ordering

## Overview
This document establishes the standard sorting conventions for snapshot and strategy queries to ensure optimal debugging and incident response UX.

## Core Principle
**Always sort by `created_at DESC` (newest first)** for audit, debugging, and troubleshooting interfaces.

## Rationale

### Why DESC (Newest First)?
- **Incident Response**: When troubleshooting recent 500 errors or issues, latest snapshots must be at the top
- **Debugging Velocity**: Developers need immediate access to most recent entries
- **User Experience**: Users expect to see their latest activity first
- **Audit Trail**: Recent activity is most relevant for investigating current issues

### When to Use ASC (Oldest First)?
- **Historical Analysis**: Reviewing origin stories or initial deployment data
- **Chronological Review**: Auditing full history from the beginning
- **Migration Verification**: Verifying first entries after a deployment

## Implementation Status

### ✅ Backend Routes (All Use DESC)

**Strategy History** (`server/routes/strategy.js:250`)
```javascript
.orderBy(desc(strategies.created_at))
```

**Latest Snapshot for User** (`server/routes/chat.js:68`)
```javascript
.orderBy(desc(snapshots.created_at))
```

**Latest Snapshot for Actions** (`server/routes/actions.js:78`)
```javascript
.orderBy(desc(snapshots.created_at))
```

**Strategy Attempts** (`server/routes/strategy.js:250`)
```javascript
.orderBy(desc(strategies.created_at))
```

**Chat Context** (`server/routes/chat-context.js`)
```javascript
.orderBy(desc(strategies.created_at))  // line 32
.orderBy(desc(rankings.created_at))    // line 40
```

### Database Admin Tools

When viewing snapshots in database admin tools (Drizzle Studio, pgAdmin, etc.):
- **Default Sort**: Change to `created_at DESC` for debugging
- **Use ASC only** when reviewing historical data from the beginning

## Convention for New Queries

When adding new endpoints that list snapshots, strategies, or audit data:

```javascript
// ✅ CORRECT - Newest first for debugging
const snapshots = await db
  .select()
  .from(snapshots)
  .orderBy(desc(snapshots.created_at))
  .limit(50);

// ❌ AVOID - Unless specifically needed for historical review
const snapshots = await db
  .select()
  .from(snapshots)
  .orderBy(asc(snapshots.created_at))  // Buries recent entries
  .limit(50);
```

## Summary

**Standard**: `created_at DESC` (newest first)
**Exception**: Only use ASC when explicitly reviewing historical data from origin

This convention maximizes debugging velocity and incident response effectiveness.
