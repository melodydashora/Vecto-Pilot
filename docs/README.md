# Documentation

Use this index to find the relevant source and supporting documentation. A guide's
date or filename does not establish that it matches today's code or deployment.
Pipeline work includes tracing the code, verifying data handoffs, correcting proven
bugs, and updating or removing the documentation affected by the change.

## Start here

| Need | Read |
|---|---|
| Session startup and continuity | [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), [partnership agreement](../AI_PARTNERSHIP_AGREEMENT.md) |
| Find a subsystem and its source | [Architecture index](architecture/README.md) |
| Database environment boundaries | [Database environments](architecture/DATABASE_ENVIRONMENTS.md) |
| Project memory, lessons and open work | [Existing MCP continuity connection](architecture/mcp-server.md) |
| Before changing an area | [Preflight cards](preflight/README.md) |
| Known documentation conflicts | [Discrepancy record](DOC_DISCREPANCIES.md) |

## Pipeline references

| Area | Reference |
|---|---|
| Offer Analyzer | [Full source trace](architecture/OFFER_ANALYZER.md), [remaining gates](architecture/OFFER_ANALYZER_ROADMAP.md), [Melody's specification](OFFER_ANALYZER_DRIVER_RULESET.md) |
| Phone setup | [iPhone](architecture/SIRI_SHORTCUT_ANALYZE.md), [Android](architecture/ANDROID_SHORTCUT_ANALYZE.md) |
| Routes | [API routes registry](api-routes-registry.md), [actual route mounting](../server/bootstrap/routes.js) |
| Models and providers | [AI role map](AI_ROLE_MAP.md), [model registry](../server/lib/ai/model-registry.js) |
| Events | [Discovery, shared storage and freshness](EVENTS.md), [venue identity and recommendations](architecture/VENUES.md) |
| Data model | [Schema reference](architecture/DB_SCHEMA.md), [actual schema](../shared/schema.js), [migrations](../migrations/README.md) |
| Client | [Client source index](../client/src/README.md) |
| Server | [API source index](../server/api/README.md), [library source index](../server/lib/README.md) |

The Analyzer trace was reconciled with source on September 29. Other pipeline guides
remain starting points for their own source reviews; this index does not certify them.

## Plans, history and research

| Location | How to use it |
|---|---|
| [coordination/](coordination/) | Dated handoffs; reconcile reported state with today's checkout. |
| [review-queue/](review-queue/README.md), [plans/](plans/README.md) | Work-item plans; current status belongs in the existing continuity tables. |
| [reviewed-queue/](reviewed-queue/README.md), [architecture/audits/](architecture/audits/README.md) | Historical findings and verification evidence, not current runtime contracts. |
| [architecture/removals/](architecture/removals/README.md) | Reasons and recovery pointers for removed or replaced material. |
| [archive/](archive/) | Preserved historical context. |
| [research/](research/README.md) | Research inputs; verify time-sensitive claims before implementation. |
| [melswork/](melswork/README.md) | Melody's working material and requirements. |

For current implementation searches, scope `rg` to the relevant source directories.
Read a linked historical record when its reasoning is needed. Duplicated or superseded
guidance should be removed with a recovery pointer instead of accumulating another copy.
