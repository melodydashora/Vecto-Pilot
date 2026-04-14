# Workflow File Listing

> **ARCHIVED 2026-04-14 — This file was generated on 2026-02-04 and no longer reflects current schema. See `docs/architecture/` for current documentation.**

Generated: 2026-02-04T18:42:32.776Z

Workflow files organized by event flow order. Non-active files appear at the end of each category.

---

## 1. Entry Points

### Files

- [agent-server.js](./agent-server.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [gateway-server.js](./gateway-server.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [index.js](./index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)

### 2. API Call

#### 2.2 Resolved in db

- `await pool.query(` - agent-server.js:444
- `await pool.query(` - agent-server.js:468

### 3. Console log

- `console.log('[agent] Using local pool (shared pool disabled)` - agent-server.js:74
- `console.error(`Failed to write log: ${err.message}`)` - agent-server.js:160
- `console.error('[agent] CRITICAL: AGENT_TOKEN must be set in prod...)` - agent-server.js:262
- `console.warn('[agent] ⚠️ Running without auth (dev mode only)` - agent-server.js:268
- `console.log(`[agent] Listening on ${HOST}:${PORT}`)` - agent-server.js:684
- `console.log(`[agent] Base directory: ${BASE_DIR}`)` - agent-server.js:685
- `console.log(`[agent] Environment: ${IS_REPLIT ? "REPLIT" : "LO...)` - agent-server.js:686
- `console.log(`[agent] Token auth: enabled`)` - agent-server.js:687
- `console.error(`[agent] ERROR: Port ${PORT} is already in use!`)` - agent-server.js:698
- `console.error(`[agent] Another process is using port ${PORT}. Ex...)` - agent-server.js:699
- `console.log("[agent] Shutting down…")` - agent-server.js:710
- `console.error('[gateway] ❌ Uncaught exception:', err)` - gateway-server.js:31
- `console.error('[gateway] ❌ Unhandled rejection at:', promise, 'r...)` - gateway-server.js:36
- `console.log(`[gateway] Starting bootstrap (PID: ${process.pid})` - gateway-server.js:43
- `console.log(`[gateway] Mode: ${MODE.toUpperCase()` - gateway-server.js:44
- `console.log(`[gateway] Deployment: ${isDeployment}, Autoscale:...)` - gateway-server.js:45
- `console.error('[gateway] ❌ Server error:', err)` - gateway-server.js:68
- `console.log(`🌐 [gateway] HTTP listening on 0.0.0.0:${PORT}`)` - gateway-server.js:76
- `console.log(`[gateway] Bootstrap completed in ${Date.now()` - gateway-server.js:77
- `console.log('[gateway] Loading modules and mounting routes...')` - gateway-server.js:89
- `console.log('[gateway] AI Config loaded')` - gateway-server.js:93
- `console.log('[gateway] ⏩ SSE disabled (autoscale mode)` - gateway-server.js:122
- `console.log(`[gateway] ${workerConfig.reason}`)` - gateway-server.js:159
- `console.log(`[gateway] ⏸️ Worker not started: ${workerConfig.r...)` - gateway-server.js:162
- `console.log('[gateway] ✅ All routes and middleware loaded')` - gateway-server.js:176
- `console.log(`[signal] ${signal} received, shutting down...`)` - gateway-server.js:181
- `console.error('[gateway] ❌ Fatal startup error:', err)` - gateway-server.js:190
- `console.log('[Unified AI] Starting health monitoring...')` - gateway-server.js:199
- `console.error('❌ [Unified AI] Health check failed:', err.message)` - gateway-server.js:206
- `console.log(`[Unified AI] Initial health: ${health.healthy ? '...)` - gateway-server.js:212
- _... and 21 more_

---

## 10. Gateway

### Files

- [server/gateway/assistant-proxy.ts](./server/gateway/assistant-proxy.ts) (active)
- [server/gateway/README.md](./server/gateway/README.md) (active) → UI: [README.md](./client/README.md)

### 3. Console log

- `console.log(`[gateway] assistant listening on ${host}:${port}`)` - server/gateway/assistant-proxy.ts:141

---

## 11. Scripts & Utils

### Files

- [server/scripts/continuous-monitor.js](./server/scripts/continuous-monitor.js) (active)
- [server/scripts/db-doctor.js](./server/scripts/db-doctor.js) (active)
- [server/scripts/fix-venue-flags.js](./server/scripts/fix-venue-flags.js) (active) → UI: [FLAG.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/FLAG.pyi)
- [server/scripts/holiday-override.js](./server/scripts/holiday-override.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/scripts/link-events.js](./server/scripts/link-events.js) (active) → UI: [events.ts](./client/src/constants/events.ts)
- [server/scripts/migrate-venue-hours.js](./server/scripts/migrate-venue-hours.js) (active)
- [server/scripts/migrate-venues-to-catalog.ARCHIVED.js](./server/scripts/migrate-venues-to-catalog.ARCHIVED.js) (active)
- [server/scripts/parse-market-research.js](./server/scripts/parse-market-research.js) (active)
- [server/scripts/README.md](./server/scripts/README.md) (active) → UI: [README.md](./client/README.md)
- [server/scripts/run-sql-migration.js](./server/scripts/run-sql-migration.js) (active)
- [server/scripts/seed-countries.js](./server/scripts/seed-countries.js) (active)
- [server/scripts/seed-dfw-venues.js](./server/scripts/seed-dfw-venues.js) (active)
- [server/scripts/seed-market-cities.js](./server/scripts/seed-market-cities.js) (active)
- [server/scripts/seed-markets.js](./server/scripts/seed-markets.js) (active)
- [server/scripts/seed-uber-airports.js](./server/scripts/seed-uber-airports.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/scripts/seed-uber-cities.js](./server/scripts/seed-uber-cities.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/scripts/self-healing-monitor.js](./server/scripts/self-healing-monitor.js) (active)
- [server/scripts/sync-events.mjs](./server/scripts/sync-events.mjs) (active) → UI: [events.ts](./client/src/constants/events.ts)
- [server/scripts/workspace-startup.sh](./server/scripts/workspace-startup.sh) (active)
- [scripts/analyze-data-flow.js](./scripts/analyze-data-flow.js) (not active)
- [scripts/check-standards.js](./scripts/check-standards.js) (not active)
- [scripts/create-all-tables.sql](./scripts/create-all-tables.sql) (not active) → UI: [CR.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/CR.pyi)
- [scripts/db-detox.js](./scripts/db-detox.js) (not active)
- [scripts/fix-market-names.js](./scripts/fix-market-names.js) (not active)
- [scripts/generate-schema-docs.js](./scripts/generate-schema-docs.js) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [scripts/generate-schema-docs.sh](./scripts/generate-schema-docs.sh) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [scripts/import-market-cities.js](./scripts/import-market-cities.js) (not active)
- [scripts/import-market-intelligence.js](./scripts/import-market-intelligence.js) (not active)
- [scripts/import-platform-data.js](./scripts/import-platform-data.js) (not active) → UI: [form.tsx](./client/src/components/ui/form.tsx)
- [scripts/load-market-research.js](./scripts/load-market-research.js) (not active)
- [scripts/make-jwks.mjs](./scripts/make-jwks.mjs) (not active)
- [scripts/memory-cli.mjs](./scripts/memory-cli.mjs) (not active)
- [scripts/populate-market-data.js](./scripts/populate-market-data.js) (not active)
- [scripts/prebuild-check.js](./scripts/prebuild-check.js) (not active) → UI: [build.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/pywin32/win32com/client/build.pyi)
- [scripts/README.md](./scripts/README.md) (not active) → UI: [README.md](./client/README.md)
- [scripts/resolve-venue-addresses.js](./scripts/resolve-venue-addresses.js) (not active) → UI: [sse.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/sse.py)
- [scripts/seed-dev.js](./scripts/seed-dev.js) (not active)
- [scripts/seed-market-intelligence.js](./scripts/seed-market-intelligence.js) (not active)
- [scripts/sign-token.mjs](./scripts/sign-token.mjs) (not active)
- [scripts/start-replit.js](./scripts/start-replit.js) (not active)
- [scripts/venue-data-cleanup.js](./scripts/venue-data-cleanup.js) (not active)

### 1. Schema

#### 1.1 actions

- 1.1.1 action_id
- 1.1.1 created_at
- 1.1.1 ranking_id
- 1.1.1 snapshot_id
- 1.1.1 user_id
- 1.1.1 action
- 1.1.1 block_id
- 1.1.1 dwell_ms
- 1.1.1 from_rank
- 1.1.1 raw

_Source: scripts/create-all-tables.sql_

#### 1.1 agent_memory

- 1.1.1 id
- 1.1.1 session_id
- 1.1.1 entry_type
- 1.1.1 title
- 1.1.1 content
- 1.1.1 status
- 1.1.1 metadata
- 1.1.1 created_at
- 1.1.1 expires_at

_Source: scripts/create-all-tables.sql_

#### 1.1 app_feedback

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at

_Source: scripts/create-all-tables.sql_

#### 1.1 countries

- 1.1.1 code
- 1.1.1 name
- 1.1.1 alpha3
- 1.1.1 phone_code
- 1.1.1 has_platform_data
- 1.1.1 display_order
- 1.1.1 is_active
- 1.1.1 created_at

_Source: server/scripts/seed-countries.js_

#### 1.1 http_idem

- 1.1.1 key
- 1.1.1 status
- 1.1.1 body
- 1.1.1 created_at

_Source: scripts/create-all-tables.sql_

#### 1.1 llm_venue_suggestions

- 1.1.1 suggestion_id
- 1.1.1 suggested_at
- 1.1.1 model_name
- 1.1.1 ranking_id
- 1.1.1 venue_name
- 1.1.1 suggested_category
- 1.1.1 llm_reasoning
- 1.1.1 validation_status
- 1.1.1 place_id_found
- 1.1.1 venue_id_created
- 1.1.1 validated_at
- 1.1.1 rejection_reason
- 1.1.1 llm_analysis

_Source: scripts/create-all-tables.sql_

#### 1.1 places_cache

- 1.1.1 coords_key
- 1.1.1 formatted_hours
- 1.1.1 cached_at
- 1.1.1 access_count

_Source: scripts/create-all-tables.sql_

#### 1.1 ranking_candidates

- 1.1.1 id
- 1.1.1 ranking_id
- 1.1.1 block_id
- 1.1.1 name
- 1.1.1 drive_time_min
- 1.1.1 rank
- 1.1.1 exploration_policy
- 1.1.1 was_forced
- 1.1.1 features
- 1.1.1 h3_r8
- 1.1.1 drive_minutes
- 1.1.1 value_grade
- 1.1.1 not_worth
- 1.1.1 trip_minutes_used
- 1.1.1 wait_minutes_used
- 1.1.1 snapshot_id
- 1.1.1 place_id
- 1.1.1 drive_time_minutes
- 1.1.1 distance_source
- 1.1.1 pro_tips
- 1.1.1 closed_reasoning
- 1.1.1 staging_tips
- 1.1.1 venue_events

_Source: scripts/create-all-tables.sql_

#### 1.1 rankings

- 1.1.1 ranking_id
- 1.1.1 created_at
- 1.1.1 snapshot_id
- 1.1.1 correlation_id
- 1.1.1 user_id
- 1.1.1 city
- 1.1.1 ui
- 1.1.1 model_name
- 1.1.1 scoring_ms
- 1.1.1 planner_ms
- 1.1.1 total_ms
- 1.1.1 timed_out
- 1.1.1 path_taken

_Source: scripts/create-all-tables.sql_

#### 1.1 snapshots

- 1.1.1 snapshot_id
- 1.1.1 created_at
- 1.1.1 user_id
- 1.1.1 device_id
- 1.1.1 session_id
- 1.1.1 coord_source
- 1.1.1 city
- 1.1.1 state
- 1.1.1 country
- 1.1.1 formatted_address
- 1.1.1 timezone
- 1.1.1 local_iso
- 1.1.1 dow
- 1.1.1 hour
- 1.1.1 day_part_key
- 1.1.1 h3_r8
- 1.1.1 weather
- 1.1.1 air
- 1.1.1 airport_context
- 1.1.1 local_news
- 1.1.1 device
- 1.1.1 permissions
- 1.1.1 extras
- 1.1.1 last_strategy_day_part
- 1.1.1 trigger_reason

_Source: scripts/create-all-tables.sql_

#### 1.1 strategies

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 correlation_id
- 1.1.1 strategy
- 1.1.1 status
- 1.1.1 error_code
- 1.1.1 error_message
- 1.1.1 attempt
- 1.1.1 latency_ms
- 1.1.1 tokens
- 1.1.1 next_retry_at
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 model_name
- 1.1.1 model_params
- 1.1.1 prompt_version
- 1.1.1 strategy_for_now
- 1.1.1 city

_Source: scripts/create-all-tables.sql_

#### 1.1 strategy_feedback

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at

_Source: scripts/create-all-tables.sql_

#### 1.1 travel_disruptions

- 1.1.1 id
- 1.1.1 country_code
- 1.1.1 airport_code
- 1.1.1 airport_name
- 1.1.1 delay_minutes
- 1.1.1 ground_stops
- 1.1.1 ground_delay_programs
- 1.1.1 closure_status
- 1.1.1 delay_reason
- 1.1.1 ai_summary
- 1.1.1 impact_level
- 1.1.1 data_source
- 1.1.1 last_updated
- 1.1.1 next_update_at

_Source: scripts/create-all-tables.sql_

#### 1.1 triad_jobs

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 kind
- 1.1.1 status
- 1.1.1 created_at

_Source: scripts/create-all-tables.sql_

#### 1.1 venue_catalog

- 1.1.1 venue_id
- 1.1.1 place_id
- 1.1.1 venue_name
- 1.1.1 address
- 1.1.1 category
- 1.1.1 dayparts
- 1.1.1 staging_notes
- 1.1.1 city
- 1.1.1 metro
- 1.1.1 ai_estimated_hours
- 1.1.1 business_hours
- 1.1.1 discovery_source
- 1.1.1 validated_at
- 1.1.1 suggestion_metadata
- 1.1.1 created_at
- 1.1.1 last_known_status
- 1.1.1 status_checked_at
- 1.1.1 consecutive_closed_checks
- 1.1.1 auto_suppressed
- 1.1.1 suppression_reason

_Source: scripts/create-all-tables.sql_

#### 1.1 venue_feedback

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 place_id
- 1.1.1 venue_name
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at

_Source: scripts/create-all-tables.sql_

#### 1.1 venue_metrics

- 1.1.1 venue_id
- 1.1.1 times_recommended
- 1.1.1 times_chosen
- 1.1.1 positive_feedback
- 1.1.1 negative_feedback
- 1.1.1 last_verified_by_driver

_Source: scripts/create-all-tables.sql_

### 2. API Call

#### 2.1 Resolved in memory

- `.filter(` - scripts/analyze-data-flow.js:46
- `new Map(` - scripts/check-standards.js:180
- `.map(` - scripts/check-standards.js:207
- `.filter(` - scripts/check-standards.js:227
- `.filter(` - scripts/check-standards.js:468
- `.filter(` - scripts/check-standards.js:469
- `.map(` - scripts/check-standards.js:230
- `.reduce(` - scripts/db-detox.js:616
- `.filter(` - scripts/fix-market-names.js:10
- `.filter(` - scripts/generate-schema-docs.js:122
- `.map(` - scripts/generate-schema-docs.js:121
- `.filter(` - scripts/import-market-cities.js:73
- `.map(` - scripts/import-market-cities.js:74
- `.map(` - scripts/import-market-cities.js:87
- `.filter(` - scripts/import-platform-data.js:81
- `.map(` - scripts/import-platform-data.js:48
- `.map(` - scripts/import-platform-data.js:50
- `.map(` - scripts/import-platform-data.js:88
- `.filter(` - scripts/memory-cli.mjs:54
- `.filter(` - scripts/resolve-venue-addresses.js:76
- `.map(` - server/scripts/db-doctor.js:16
- `.map(` - server/scripts/db-doctor.js:31
- `.map(` - server/scripts/fix-venue-flags.js:111
- `.map(` - server/scripts/fix-venue-flags.js:69
- `.map(` - server/scripts/fix-venue-flags.js:77
- `.map(` - server/scripts/fix-venue-flags.js:78
- `.map(` - server/scripts/fix-venue-flags.js:129
- `.map(` - server/scripts/fix-venue-flags.js:165
- `.map(` - server/scripts/fix-venue-flags.js:194
- `.map(` - server/scripts/migrate-venue-hours.js:126
- _... and 37 more_

#### 2.2 Resolved in db

- `await pool.query(` - scripts/db-detox.js:59
- `await pool.query(` - scripts/db-detox.js:70
- `await pool.query(` - scripts/db-detox.js:93
- `await pool.query(` - scripts/db-detox.js:103
- `await pool.query(` - scripts/db-detox.js:147
- `await pool.query(` - scripts/db-detox.js:174
- `await pool.query(` - scripts/db-detox.js:201
- `await pool.query(` - scripts/db-detox.js:224
- `await pool.query(` - scripts/db-detox.js:238
- `await pool.query(` - scripts/db-detox.js:416
- `await pool.query(` - scripts/db-detox.js:448
- `await pool.query(` - scripts/db-detox.js:488
- `await pool.query(` - scripts/db-detox.js:540
- `await db.execute(` - scripts/fix-market-names.js:29
- `await db.execute(` - scripts/fix-market-names.js:42
- `await db.insert(` - scripts/import-market-cities.js:157
- `await db.insert(` - scripts/import-market-intelligence.js:53
- `await db.insert(` - scripts/import-platform-data.js:110
- `await db.insert(` - scripts/import-platform-data.js:121
- `await db.execute(` - scripts/load-market-research.js:162
- `await db.execute(` - scripts/populate-market-data.js:404
- `await db.execute(` - scripts/populate-market-data.js:436
- `await db.execute(` - scripts/populate-market-data.js:458
- `await db.execute(` - scripts/populate-market-data.js:475
- `db.select(` - scripts/resolve-venue-addresses.js:248
- `await db.update(` - scripts/resolve-venue-addresses.js:297
- `await db.insert(` - scripts/seed-dev.js:21
- `await db.insert(` - scripts/seed-dev.js:75
- `await db.insert(` - scripts/seed-dev.js:101
- `await db.execute(` - scripts/seed-market-intelligence.js:885
- _... and 64 more_

### 3. Console log

- `console.log('🔍 Analyzing data flow across codebase...\n')` - scripts/analyze-data-flow.js:116
- `console.log(` push: ${result.push.length}, fetch: ${result.fet...)` - scripts/analyze-data-flow.js:128
- `console.log(`\n✅ Analysis complete: ${OUTPUT_FILE}`)` - scripts/analyze-data-flow.js:133
- `console.log(`   Tables: ${DRIZZLE_TABLES.length}`)` - scripts/analyze-data-flow.js:134
- `console.log(`   Total push references: ${totalPush}`)` - scripts/analyze-data-flow.js:135
- `console.log(`   Total fetch references: ${totalFetch}`)` - scripts/analyze-data-flow.js:136
- `console.log(`[${prefix}] ${message}`)` - scripts/check-standards.js:73
- `console.log('\n' + '═'.repeat(70)` - scripts/check-standards.js:458
- `console.log('STANDARDS CHECK REPORT')` - scripts/check-standards.js:459
- `console.log('═'.repeat(70)` - scripts/check-standards.js:460
- `console.log(`Checks run: ${checksRun}`)` - scripts/check-standards.js:462
- `console.log(`Checks passed: ${checksPassed}`)` - scripts/check-standards.js:463
- `console.log(`Total violations: ${violations.length}\n`)` - scripts/check-standards.js:464
- `console.log('\x1b[31m━━━ ERRORS (CI Blocking)` - scripts/check-standards.js:472
- `console.log(`  ${v.file}:${v.line}`)` - scripts/check-standards.js:474
- `console.log(`    [${v.check}] ${v.message}\n`)` - scripts/check-standards.js:475
- `console.log('\x1b[33m━━━ WARNINGS ━━━\x1b[0m\n')` - scripts/check-standards.js:480
- `console.log(`  ${v.file}:${v.line}`)` - scripts/check-standards.js:482
- `console.log(`    [${v.check}] ${v.message}\n`)` - scripts/check-standards.js:483
- `console.log('═'.repeat(70)` - scripts/check-standards.js:488
- `console.log('\x1b[31m✗ FAILED - Fix errors before merging\x1b[...)` - scripts/check-standards.js:492
- `console.log('\x1b[33m⚠ PASSED WITH WARNINGS\x1b[0m')` - scripts/check-standards.js:495
- `console.log('\x1b[32m✓ ALL CHECKS PASSED\x1b[0m')` - scripts/check-standards.js:498
- `console.log('\n🔍 Repository Standards Checker')` - scripts/check-standards.js:504
- `console.log('   See docs/architecture/standards.md for rules\n...)` - scripts/check-standards.js:505
- `console.log(`\n${'═'.repeat(60)` - scripts/db-detox.js:33
- `console.log(`\n${'─'.repeat(50)` - scripts/db-detox.js:34
- `console.log(`  ℹ️  ${msg}`)` - scripts/db-detox.js:35
- `console.log(`  ✅ ${msg}`)` - scripts/db-detox.js:36
- `console.log(`  ⚠️  ${msg}`)` - scripts/db-detox.js:37
- _... and 644 more_

---

## 12. Shared

### Files

- [shared/config.js](./shared/config.js) (active)
- [shared/identity.ts](./shared/identity.ts) (active)
- [shared/ports.js](./shared/ports.js) (active)
- [shared/README.md](./shared/README.md) (active) → UI: [README.md](./client/README.md)
- [shared/schema.js](./shared/schema.js) (active)
- [shared/types/action.ts](./shared/types/action.ts) (active)
- [shared/types/ids.ts](./shared/types/ids.ts) (active)
- [shared/types/location.ts](./shared/types/location.ts) (active) → UI: [location-context-clean.tsx](./client/src/contexts/location-context-clean.tsx)
- [shared/types/README.md](./shared/types/README.md) (active) → UI: [README.md](./client/README.md)
- [shared/types/reco.ts](./shared/types/reco.ts) (active)
- [shared/types/snapshot.ts](./shared/types/snapshot.ts) (active)

### 1. Schema

#### 1.1 actions


_Source: shared/schema.js_

#### 1.1 agent_changes


_Source: shared/schema.js_

#### 1.1 agent_memory


_Source: shared/schema.js_

#### 1.1 app_feedback


_Source: shared/schema.js_

#### 1.1 assistant_memory


_Source: shared/schema.js_

#### 1.1 auth_credentials


_Source: shared/schema.js_

#### 1.1 block_jobs


_Source: shared/schema.js_

#### 1.1 briefings


_Source: shared/schema.js_

#### 1.1 coach_conversations


_Source: shared/schema.js_

#### 1.1 coach_system_notes


_Source: shared/schema.js_

#### 1.1 connection_audit


_Source: shared/schema.js_

#### 1.1 coords_cache


_Source: shared/schema.js_

#### 1.1 countries


_Source: shared/schema.js_

#### 1.1 cross_thread_memory


_Source: shared/schema.js_

#### 1.1 discovered_events


_Source: shared/schema.js_

#### 1.1 driver_goals


_Source: shared/schema.js_

#### 1.1 driver_profiles


_Source: shared/schema.js_

#### 1.1 driver_tasks


_Source: shared/schema.js_

#### 1.1 driver_vehicles


_Source: shared/schema.js_

#### 1.1 eidolon_memory


_Source: shared/schema.js_

#### 1.1 eidolon_snapshots


_Source: shared/schema.js_

#### 1.1 http_idem


_Source: shared/schema.js_

#### 1.1 intercepted_signals


_Source: shared/schema.js_

#### 1.1 llm_venue_suggestions


_Source: shared/schema.js_

#### 1.1 market_intel


_Source: shared/schema.js_

#### 1.1 market_intelligence


_Source: shared/schema.js_

#### 1.1 markets


_Source: shared/schema.js_

#### 1.1 news_deactivations


_Source: shared/schema.js_

#### 1.1 places_cache


_Source: shared/schema.js_

#### 1.1 platform_data


_Source: shared/schema.js_

#### 1.1 ranking_candidates


_Source: shared/schema.js_

#### 1.1 rankings


_Source: shared/schema.js_

#### 1.1 safe_zones


_Source: shared/schema.js_

#### 1.1 snapshots


_Source: shared/schema.js_

#### 1.1 staging_saturation


_Source: shared/schema.js_

#### 1.1 strategies


_Source: shared/schema.js_

#### 1.1 strategy_feedback


_Source: shared/schema.js_

#### 1.1 traffic_zones


_Source: shared/schema.js_

#### 1.1 travel_disruptions


_Source: shared/schema.js_

#### 1.1 triad_jobs


_Source: shared/schema.js_

#### 1.1 us_market_cities


_Source: shared/schema.js_

#### 1.1 user_intel_notes


_Source: shared/schema.js_

#### 1.1 users


_Source: shared/schema.js_

#### 1.1 vehicle_makes_cache


_Source: shared/schema.js_

#### 1.1 vehicle_models_cache


_Source: shared/schema.js_

#### 1.1 venue_catalog


_Source: shared/schema.js_

#### 1.1 venue_events


_Source: shared/schema.js_

#### 1.1 venue_feedback


_Source: shared/schema.js_

#### 1.1 venue_metrics


_Source: shared/schema.js_

#### 1.1 verification_codes


_Source: shared/schema.js_

#### 1.1 zone_intelligence

- 1.1.1 user_id
- 1.1.1 device_id
- 1.1.1 session_id
- 1.1.1 current_snapshot_id
- 1.1.1 session_start_at
- 1.1.1 last_active_at
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 snapshot_id
- 1.1.1 created_at
- 1.1.1 date
- 1.1.1 device_id
- 1.1.1 session_id
- 1.1.1 user_id
- 1.1.1 coord_key
- 1.1.1 city
- 1.1.1 state
- 1.1.1 country
- 1.1.1 formatted_address
- 1.1.1 timezone
- 1.1.1 market
- 1.1.1 local_iso
- 1.1.1 dow
- 1.1.1 hour
- 1.1.1 day_part_key
- 1.1.1 h3_r8
- 1.1.1 weather
- 1.1.1 air
- 1.1.1 permissions
- 1.1.1 holiday
- 1.1.1 is_holiday
- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 user_id
- 1.1.1 status
- 1.1.1 phase
- 1.1.1 phase_started_at
- 1.1.1 error_message
- 1.1.1 strategy_for_now
- 1.1.1 consolidated_strategy
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 news
- 1.1.1 weather_current
- 1.1.1 weather_forecast
- 1.1.1 traffic_conditions
- 1.1.1 events
- 1.1.1 school_closures
- 1.1.1 airport_conditions
- 1.1.1 holiday
- 1.1.1 status
- 1.1.1 generated_at
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 ranking_id
- 1.1.1 created_at
- 1.1.1 snapshot_id
- 1.1.1 correlation_id
- 1.1.1 user_id
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 ui
- 1.1.1 model_name
- 1.1.1 scoring_ms
- 1.1.1 planner_ms
- 1.1.1 total_ms
- 1.1.1 timed_out
- 1.1.1 path_taken
- 1.1.1 id
- 1.1.1 ranking_id
- 1.1.1 block_id
- 1.1.1 name
- 1.1.1 drive_time_min
- 1.1.1 rank
- 1.1.1 exploration_policy
- 1.1.1 was_forced
- 1.1.1 features
- 1.1.1 h3_r8
- 1.1.1 drive_minutes
- 1.1.1 value_grade
- 1.1.1 not_worth
- 1.1.1 trip_minutes_used
- 1.1.1 wait_minutes_used
- 1.1.1 snapshot_id
- 1.1.1 place_id
- 1.1.1 drive_time_minutes
- 1.1.1 distance_source
- 1.1.1 pro_tips
- 1.1.1 closed_reasoning
- 1.1.1 staging_tips
- 1.1.1 staging_name
- 1.1.1 business_hours
- 1.1.1 venue_events
- 1.1.1 event_badge_missing
- 1.1.1 node_type
- 1.1.1 access_status
- 1.1.1 aliases
- 1.1.1 district
- 1.1.1 action_id
- 1.1.1 created_at
- 1.1.1 ranking_id
- 1.1.1 snapshot_id
- 1.1.1 user_id
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 action
- 1.1.1 block_id
- 1.1.1 dwell_ms
- 1.1.1 from_rank
- 1.1.1 raw
- 1.1.1 venue_id
- 1.1.1 place_id
- 1.1.1 venue_name
- 1.1.1 address
- 1.1.1 category
- 1.1.1 dayparts
- 1.1.1 staging_notes
- 1.1.1 city
- 1.1.1 metro
- 1.1.1 district
- 1.1.1 district_slug
- 1.1.1 ai_estimated_hours
- 1.1.1 business_hours
- 1.1.1 discovery_source
- 1.1.1 validated_at
- 1.1.1 suggestion_metadata
- 1.1.1 created_at
- 1.1.1 last_known_status
- 1.1.1 status_checked_at
- 1.1.1 consecutive_closed_checks
- 1.1.1 auto_suppressed
- 1.1.1 suppression_reason
- 1.1.1 state
- 1.1.1 address_1
- 1.1.1 address_2
- 1.1.1 zip
- 1.1.1 country
- 1.1.1 formatted_address
- 1.1.1 normalized_name
- 1.1.1 coord_key
- 1.1.1 venue_types
- 1.1.1 market_slug
- 1.1.1 expense_rank
- 1.1.1 hours_full_week
- 1.1.1 crowd_level
- 1.1.1 rideshare_potential
- 1.1.1 hours_source
- 1.1.1 capacity_estimate
- 1.1.1 source
- 1.1.1 source_model
- 1.1.1 access_count
- 1.1.1 last_accessed_at
- 1.1.1 updated_at
- 1.1.1 is_bar
- 1.1.1 is_event_venue
- 1.1.1 record_status
- 1.1.1 venue_id
- 1.1.1 times_recommended
- 1.1.1 times_chosen
- 1.1.1 positive_feedback
- 1.1.1 negative_feedback
- 1.1.1 last_verified_by_driver
- 1.1.1 id
- 1.1.1 status
- 1.1.1 request_body
- 1.1.1 result
- 1.1.1 error
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 kind
- 1.1.1 status
- 1.1.1 created_at
- 1.1.1 key
- 1.1.1 status
- 1.1.1 body
- 1.1.1 created_at
- 1.1.1 coords_key
- 1.1.1 formatted_hours
- 1.1.1 cached_at
- 1.1.1 access_count
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 place_id
- 1.1.1 venue_name
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 country_code
- 1.1.1 airport_code
- 1.1.1 airport_name
- 1.1.1 delay_minutes
- 1.1.1 ground_stops
- 1.1.1 ground_delay_programs
- 1.1.1 closure_status
- 1.1.1 delay_reason
- 1.1.1 ai_summary
- 1.1.1 impact_level
- 1.1.1 data_source
- 1.1.1 last_updated
- 1.1.1 next_update_at
- 1.1.1 suggestion_id
- 1.1.1 suggested_at
- 1.1.1 model_name
- 1.1.1 ranking_id
- 1.1.1 venue_name
- 1.1.1 suggested_category
- 1.1.1 llm_reasoning
- 1.1.1 validation_status
- 1.1.1 place_id_found
- 1.1.1 venue_id_created
- 1.1.1 validated_at
- 1.1.1 rejection_reason
- 1.1.1 llm_analysis
- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 user_id
- 1.1.1 session_id
- 1.1.1 scope
- 1.1.1 state
- 1.1.1 metadata
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 id
- 1.1.1 venue_id
- 1.1.1 place_id
- 1.1.1 title
- 1.1.1 starts_at
- 1.1.1 ends_at
- 1.1.1 source
- 1.1.1 radius_m
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 title
- 1.1.1 venue_name
- 1.1.1 address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 venue_id
- 1.1.1 event_start_date
- 1.1.1 event_start_time
- 1.1.1 event_end_date
- 1.1.1 event_end_time
- 1.1.1 category
- 1.1.1 expected_attendance
- 1.1.1 event_hash
- 1.1.1 discovered_at
- 1.1.1 updated_at
- 1.1.1 is_verified
- 1.1.1 is_active
- 1.1.1 deactivation_reason
- 1.1.1 deactivated_at
- 1.1.1 deactivated_by
- 1.1.1 id
- 1.1.1 city
- 1.1.1 state
- 1.1.1 traffic_density
- 1.1.1 density_level
- 1.1.1 congestion_areas
- 1.1.1 high_demand_zones
- 1.1.1 driver_advice
- 1.1.1 sources
- 1.1.1 created_at
- 1.1.1 expires_at
- 1.1.1 id
- 1.1.1 change_type
- 1.1.1 description
- 1.1.1 file_path
- 1.1.1 details
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 occurred_at
- 1.1.1 event
- 1.1.1 backend_pid
- 1.1.1 application_name
- 1.1.1 reason
- 1.1.1 deploy_mode
- 1.1.1 details
- 1.1.1 id
- 1.1.1 coord_key
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 country
- 1.1.1 timezone
- 1.1.1 closest_airport
- 1.1.1 closest_airport_code
- 1.1.1 created_at
- 1.1.1 hit_count
- 1.1.1 id
- 1.1.1 platform
- 1.1.1 country
- 1.1.1 country_code
- 1.1.1 region
- 1.1.1 city
- 1.1.1 market
- 1.1.1 market_anchor
- 1.1.1 region_type
- 1.1.1 timezone
- 1.1.1 coord_boundary
- 1.1.1 is_active
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 code
- 1.1.1 name
- 1.1.1 alpha3
- 1.1.1 phone_code
- 1.1.1 has_platform_data
- 1.1.1 display_order
- 1.1.1 is_active
- 1.1.1 created_at
- 1.1.1 market_slug
- 1.1.1 market_name
- 1.1.1 primary_city
- 1.1.1 state
- 1.1.1 country_code
- 1.1.1 timezone
- 1.1.1 primary_airport_code
- 1.1.1 secondary_airports
- 1.1.1 city_aliases
- 1.1.1 has_uber
- 1.1.1 has_lyft
- 1.1.1 is_active
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 state
- 1.1.1 state_abbr
- 1.1.1 city
- 1.1.1 market_name
- 1.1.1 region_type
- 1.1.1 source_ref
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 market_name
- 1.1.1 intel_type
- 1.1.1 title
- 1.1.1 content
- 1.1.1 insight_data
- 1.1.1 valid_from
- 1.1.1 valid_until
- 1.1.1 day_of_week
- 1.1.1 time_of_day
- 1.1.1 source
- 1.1.1 source_model
- 1.1.1 contributed_by
- 1.1.1 priority
- 1.1.1 is_active
- 1.1.1 view_count
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 first_name
- 1.1.1 last_name
- 1.1.1 driver_nickname
- 1.1.1 email
- 1.1.1 phone
- 1.1.1 address_1
- 1.1.1 address_2
- 1.1.1 city
- 1.1.1 state_territory
- 1.1.1 zip_code
- 1.1.1 country
- 1.1.1 home_formatted_address
- 1.1.1 home_timezone
- 1.1.1 market
- 1.1.1 rideshare_platforms
- 1.1.1 elig_economy
- 1.1.1 elig_xl
- 1.1.1 elig_xxl
- 1.1.1 elig_comfort
- 1.1.1 elig_luxury_sedan
- 1.1.1 elig_luxury_suv
- 1.1.1 attr_electric
- 1.1.1 attr_green
- 1.1.1 attr_wav
- 1.1.1 attr_ski
- 1.1.1 attr_car_seat
- 1.1.1 pref_pet_friendly
- 1.1.1 pref_teen
- 1.1.1 pref_assist
- 1.1.1 pref_shared
- 1.1.1 uber_black
- 1.1.1 uber_xxl
- 1.1.1 uber_comfort
- 1.1.1 uber_x
- 1.1.1 uber_x_share
- 1.1.1 marketing_opt_in
- 1.1.1 terms_accepted
- 1.1.1 terms_accepted_at
- 1.1.1 terms_version
- 1.1.1 email_verified
- 1.1.1 phone_verified
- 1.1.1 profile_complete
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 driver_profile_id
- 1.1.1 year
- 1.1.1 make
- 1.1.1 model
- 1.1.1 color
- 1.1.1 license_plate
- 1.1.1 seatbelts
- 1.1.1 is_primary
- 1.1.1 is_active
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 password_hash
- 1.1.1 failed_login_attempts
- 1.1.1 locked_until
- 1.1.1 last_login_at
- 1.1.1 last_login_ip
- 1.1.1 password_reset_token
- 1.1.1 password_reset_expires
- 1.1.1 password_changed_at
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 code
- 1.1.1 code_type
- 1.1.1 destination
- 1.1.1 used_at
- 1.1.1 expires_at
- 1.1.1 attempts
- 1.1.1 max_attempts
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 make_id
- 1.1.1 make_name
- 1.1.1 is_common
- 1.1.1 cached_at
- 1.1.1 id
- 1.1.1 make_id
- 1.1.1 make_name
- 1.1.1 model_id
- 1.1.1 model_name
- 1.1.1 model_year
- 1.1.1 cached_at
- 1.1.1 id
- 1.1.1 market
- 1.1.1 market_slug
- 1.1.1 platform
- 1.1.1 intel_type
- 1.1.1 intel_subtype
- 1.1.1 title
- 1.1.1 summary
- 1.1.1 content
- 1.1.1 neighborhoods
- 1.1.1 boundaries
- 1.1.1 time_context
- 1.1.1 tags
- 1.1.1 priority
- 1.1.1 source
- 1.1.1 source_file
- 1.1.1 source_section
- 1.1.1 confidence
- 1.1.1 version
- 1.1.1 effective_date
- 1.1.1 expiry_date
- 1.1.1 is_active
- 1.1.1 is_verified
- 1.1.1 coach_can_cite
- 1.1.1 coach_priority
- 1.1.1 created_by
- 1.1.1 updated_by
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 note_type
- 1.1.1 category
- 1.1.1 title
- 1.1.1 content
- 1.1.1 context
- 1.1.1 market_slug
- 1.1.1 neighborhoods
- 1.1.1 importance
- 1.1.1 confidence
- 1.1.1 times_referenced
- 1.1.1 valid_from
- 1.1.1 valid_until
- 1.1.1 is_active
- 1.1.1 is_pinned
- 1.1.1 source_message_id
- 1.1.1 created_by
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 market_slug
- 1.1.1 conversation_id
- 1.1.1 parent_message_id
- 1.1.1 role
- 1.1.1 content
- 1.1.1 content_type
- 1.1.1 topic_tags
- 1.1.1 extracted_tips
- 1.1.1 sentiment
- 1.1.1 location_context
- 1.1.1 time_context
- 1.1.1 tokens_in
- 1.1.1 tokens_out
- 1.1.1 model_used
- 1.1.1 is_edited
- 1.1.1 is_regenerated
- 1.1.1 is_starred
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 note_type
- 1.1.1 category
- 1.1.1 priority
- 1.1.1 title
- 1.1.1 description
- 1.1.1 user_quote
- 1.1.1 triggering_user_id
- 1.1.1 triggering_conversation_id
- 1.1.1 triggering_snapshot_id
- 1.1.1 occurrence_count
- 1.1.1 affected_users
- 1.1.1 market_slug
- 1.1.1 is_market_specific
- 1.1.1 status
- 1.1.1 reviewed_at
- 1.1.1 reviewed_by
- 1.1.1 implementation_notes
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 device_id
- 1.1.1 user_id
- 1.1.1 raw_text
- 1.1.1 parsed_data
- 1.1.1 decision
- 1.1.1 decision_reasoning
- 1.1.1 user_override
- 1.1.1 source
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 goal_type
- 1.1.1 target_unit
- 1.1.1 deadline
- 1.1.1 urgency
- 1.1.1 is_active
- 1.1.1 completed_at
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 title
- 1.1.1 description
- 1.1.1 due_at
- 1.1.1 duration_minutes
- 1.1.1 location
- 1.1.1 place_id
- 1.1.1 is_hard_stop
- 1.1.1 priority
- 1.1.1 is_complete
- 1.1.1 completed_at
- 1.1.1 recurrence
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 zone_name
- 1.1.1 zone_type
- 1.1.1 geometry
- 1.1.1 neighborhoods
- 1.1.1 risk_level
- 1.1.1 risk_notes
- 1.1.1 is_active
- 1.1.1 applies_at_night
- 1.1.1 applies_at_day
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 h3_cell
- 1.1.1 venue_name
- 1.1.1 window_start
- 1.1.1 window_end
- 1.1.1 suggestion_count
- 1.1.1 active_drivers
- 1.1.1 market_slug
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 news_hash
- 1.1.1 news_title
- 1.1.1 news_source
- 1.1.1 reason
- 1.1.1 deactivated_by
- 1.1.1 scope
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 market_slug
- 1.1.1 zone_type
- 1.1.1 zone_name
- 1.1.1 zone_description
- 1.1.1 address_hint
- 1.1.1 time_constraints
- 1.1.1 is_time_specific
- 1.1.1 reports_count
- 1.1.1 confidence_score
- 1.1.1 contributing_users
- 1.1.1 source_conversations
- 1.1.1 last_reason
- 1.1.1 last_reported_by
- 1.1.1 last_reported_at
- 1.1.1 is_active
- 1.1.1 verified_by_admin
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: shared/schema.js_

### 2. API Call

#### 2.1 Resolved in memory

- `localStorage.` - shared/identity.ts:15
- `localStorage.` - shared/identity.ts:18
- `localStorage.` - shared/identity.ts:24
- `localStorage.` - shared/identity.ts:27
- `localStorage.` - shared/identity.ts:34
- `localStorage.` - shared/identity.ts:36
- `localStorage.` - shared/identity.ts:40
- `localStorage.` - shared/identity.ts:43
- `localStorage.` - shared/identity.ts:56

### 3. Console log

- `console.error(err)` - .cache/uv/archive-v0/03ZRVmC8J8dBKjzQWqzKO/werkzeug/debug/shared/debugger.js:74
- `console.error(err)` - .cache/uv/archive-v0/03ZRVmC8J8dBKjzQWqzKO/werkzeug/debug/shared/debugger.js:306
- `console.error(err)` - .cache/uv/archive-v0/TCqdgImOVouBbEcve1Ics/werkzeug/debug/shared/debugger.js:74
- `console.error(err)` - .cache/uv/archive-v0/TCqdgImOVouBbEcve1Ics/werkzeug/debug/shared/debugger.js:306
- `console.log('[config] ✅ Environment validation passed')` - shared/config.js:61
- `console.error('[config] ❌ Environment validation failed:')` - shared/config.js:64
- `console.error(`  - ${error.path.join('.')` - shared/config.js:66
- `console.error('\n[config] Please check your .env file and ensure...)` - shared/config.js:68
- `console.error('[config] See .env.example for reference.\n')` - shared/config.js:69

---

## 13. Other Workflow

### Files

- [server/agent/agent-override-llm.js](./server/agent/agent-override-llm.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/agent/config-manager.js](./server/agent/config-manager.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/agent/context-awareness.js](./server/agent/context-awareness.js) (active)
- [server/agent/embed.js](./server/agent/embed.js) (active)
- [server/agent/enhanced-context.js](./server/agent/enhanced-context.js) (active)
- [server/agent/index.ts](./server/agent/index.ts) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/agent/README.md](./server/agent/README.md) (active) → UI: [README.md](./client/README.md)
- [server/agent/routes.js](./server/agent/routes.js) (active) → UI: [apiRoutes.ts](./client/src/constants/apiRoutes.ts)
- [server/agent/thread-context.js](./server/agent/thread-context.js) (active)
- [server/api/auth/auth.js](./server/api/auth/auth.js) (active) → UI: [oauth2.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/auth/oauth2.py)
- [server/api/auth/index.js](./server/api/auth/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/auth/README.md](./server/api/auth/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/auth/uber.js](./server/api/auth/uber.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/api/briefing/briefing.js](./server/api/briefing/briefing.js) (active) → UI: [BriefingTab.tsx](./client/src/components/BriefingTab.tsx)
- [server/api/briefing/index.js](./server/api/briefing/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/briefing/README.md](./server/api/briefing/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/chat/chat-context.js](./server/api/chat/chat-context.js) (active)
- [server/api/chat/chat.js](./server/api/chat/chat.js) (active) → UI: [AICoach.tsx](./client/src/components/AICoach.tsx)
- [server/api/chat/index.js](./server/api/chat/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/chat/README.md](./server/api/chat/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/chat/realtime.js](./server/api/chat/realtime.js) (active)
- [server/api/chat/tts.js](./server/api/chat/tts.js) (active) → UI: [useTTS.ts](./client/src/hooks/useTTS.ts)
- [server/api/coach/index.js](./server/api/coach/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/coach/notes.js](./server/api/coach/notes.js) (active)
- [server/api/coach/README.md](./server/api/coach/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/coach/schema.js](./server/api/coach/schema.js) (active)
- [server/api/coach/validate.js](./server/api/coach/validate.js) (active)
- [server/api/feedback/actions.js](./server/api/feedback/actions.js) (active)
- [server/api/feedback/feedback.js](./server/api/feedback/feedback.js) (active) → UI: [FeedbackModal.tsx](./client/src/components/FeedbackModal.tsx)
- [server/api/feedback/index.js](./server/api/feedback/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/feedback/README.md](./server/api/feedback/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/health/diagnostic-identity.js](./server/api/health/diagnostic-identity.js) (active)
- [server/api/health/diagnostics-strategy.js](./server/api/health/diagnostics-strategy.js) (active)
- [server/api/health/diagnostics.js](./server/api/health/diagnostics.js) (active)
- [server/api/health/health.js](./server/api/health/health.js) (active)
- [server/api/health/index.js](./server/api/health/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/health/job-metrics.js](./server/api/health/job-metrics.js) (active)
- [server/api/health/ml-health.js](./server/api/health/ml-health.js) (active)
- [server/api/health/README.md](./server/api/health/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/health/unified-capabilities.js](./server/api/health/unified-capabilities.js) (active)
- [server/api/intelligence/index.js](./server/api/intelligence/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/intelligence/README.md](./server/api/intelligence/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/location/index.js](./server/api/location/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/location/location.js](./server/api/location/location.js) (active) → UI: [location-context-clean.tsx](./client/src/contexts/location-context-clean.tsx)
- [server/api/location/README.md](./server/api/location/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/location/snapshot.js](./server/api/location/snapshot.js) (active)
- [server/api/platform/index.js](./server/api/platform/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/platform/README.md](./server/api/platform/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/README.md](./server/api/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/research/index.js](./server/api/research/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/research/README.md](./server/api/research/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/research/research.js](./server/api/research/research.js) (active)
- [server/api/research/vector-search.js](./server/api/research/vector-search.js) (active)
- [server/api/strategy/blocks-fast.js](./server/api/strategy/blocks-fast.js) (active)
- [server/api/strategy/content-blocks.js](./server/api/strategy/content-blocks.js) (active)
- [server/api/strategy/index.js](./server/api/strategy/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/strategy/README.md](./server/api/strategy/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/strategy/strategy-events.js](./server/api/strategy/strategy-events.js) (active) → UI: [events.ts](./client/src/constants/events.ts)
- [server/api/strategy/strategy.js](./server/api/strategy/strategy.js) (active) → UI: [StrategyCards.tsx](./client/src/components/intel/StrategyCards.tsx)
- [server/api/strategy/tactical-plan.js](./server/api/strategy/tactical-plan.js) (active)
- [server/api/utils/http-helpers.js](./server/api/utils/http-helpers.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/api/utils/index.js](./server/api/utils/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/utils/README.md](./server/api/utils/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/utils/safeElapsedMs.js](./server/api/utils/safeElapsedMs.js) (active)
- [server/api/vehicle/README.md](./server/api/vehicle/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/vehicle/vehicle.js](./server/api/vehicle/vehicle.js) (active)
- [server/api/venue/closed-venue-reasoning.js](./server/api/venue/closed-venue-reasoning.js) (active)
- [server/api/venue/index.js](./server/api/venue/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/api/venue/README.md](./server/api/venue/README.md) (active) → UI: [README.md](./client/README.md)
- [server/api/venue/venue-events.js](./server/api/venue/venue-events.js) (active) → UI: [events.ts](./client/src/constants/events.ts)
- [server/api/venue/venue-intelligence.js](./server/api/venue/venue-intelligence.js) (active)
- [server/assistant/enhanced-context.js](./server/assistant/enhanced-context.js) (active)
- [server/assistant/policy-loader.js](./server/assistant/policy-loader.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/assistant/policy-middleware.js](./server/assistant/policy-middleware.js) (active)
- [server/assistant/README.md](./server/assistant/README.md) (active) → UI: [README.md](./client/README.md)
- [server/assistant/routes.js](./server/assistant/routes.js) (active) → UI: [apiRoutes.ts](./client/src/constants/apiRoutes.ts)
- [server/assistant/thread-context.js](./server/assistant/thread-context.js) (active)
- [server/diagnostics.sh](./server/diagnostics.sh) (active)
- [server/events/phase-emitter.js](./server/events/phase-emitter.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/logger/logger.js](./server/logger/logger.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/logger/ndjson.js](./server/logger/ndjson.js) (active)
- [server/logger/README.md](./server/logger/README.md) (active) → UI: [README.md](./client/README.md)
- [server/logger/workflow.js](./server/logger/workflow.js) (active)
- [server/README.md](./server/README.md) (active) → UI: [README.md](./client/README.md)
- [server/types/driving-plan.ts](./server/types/driving-plan.ts) (active)
- [server/types/README.md](./server/types/README.md) (active) → UI: [README.md](./client/README.md)
- [server/util/circuit.js](./server/util/circuit.js) (active)
- [server/util/eta.js](./server/util/eta.js) (active) → UI: [METADATA.toml](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/JACK-Client/METADATA.toml)
- [server/util/README.md](./server/util/README.md) (active) → UI: [README.md](./client/README.md)
- [server/util/uuid.js](./server/util/uuid.js) (active)
- [server/util/validate-snapshot.js](./server/util/validate-snapshot.js) (active)
- [server/validation/README.md](./server/validation/README.md) (active) → UI: [README.md](./client/README.md)
- [server/validation/response-schemas.js](./server/validation/response-schemas.js) (active)
- [server/validation/schemas.js](./server/validation/schemas.js) (active)
- [server/validation/transformers.js](./server/validation/transformers.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)

### 2. API Call

#### 2.1 Resolved in memory

- `.map(` - server/agent/context-awareness.js:26
- `.map(` - server/agent/context-awareness.js:37
- `.map(` - server/agent/context-awareness.js:47
- `.map(` - server/agent/context-awareness.js:63
- `.map(` - server/agent/context-awareness.js:75
- `.map(` - server/agent/context-awareness.js:87
- `.map(` - server/agent/context-awareness.js:155
- `.map(` - server/agent/embed.js:55
- `.map(` - server/agent/embed.js:27
- `.map(` - server/agent/enhanced-context.js:111
- `.map(` - server/agent/enhanced-context.js:126
- `.map(` - server/agent/enhanced-context.js:140
- `.map(` - server/agent/enhanced-context.js:159
- `.map(` - server/agent/enhanced-context.js:173
- `.map(` - server/agent/enhanced-context.js:187
- `.map(` - server/agent/enhanced-context.js:200
- `.map(` - server/agent/enhanced-context.js:446
- `.map(` - server/agent/enhanced-context.js:465
- `.map(` - server/agent/routes.js:215
- `new Map(` - server/agent/thread-context.js:447
- `new Map(` - server/agent/thread-context.js:448
- `new Map(` - server/agent/thread-context.js:449
- `.filter(` - server/agent/thread-context.js:206
- `.filter(` - server/agent/thread-context.js:277
- `.filter(` - server/agent/thread-context.js:294
- `.map(` - server/agent/thread-context.js:207
- `.map(` - server/agent/thread-context.js:232
- `.map(` - server/agent/thread-context.js:293
- `.map(` - server/agent/thread-context.js:338
- `.map(` - server/agent/thread-context.js:393
- _... and 112 more_

#### 2.2 Resolved in db

- `await db.select(` - server/agent/context-awareness.js:25
- `await db.select(` - server/agent/context-awareness.js:36
- `await db.select(` - server/agent/context-awareness.js:46
- `await db.execute(` - server/agent/context-awareness.js:175
- `await db.select(` - server/agent/enhanced-context.js:110
- `await db.select(` - server/agent/enhanced-context.js:125
- `await db.select(` - server/agent/enhanced-context.js:139
- `await db.execute(` - server/agent/enhanced-context.js:344
- `await db.execute(` - server/agent/enhanced-context.js:369
- `await db.select(` - server/agent/enhanced-context.js:387
- `await pool.query(` - server/agent/enhanced-context.js:419
- `await pool.query(` - server/agent/enhanced-context.js:456
- `await pool.query(` - server/agent/thread-context.js:126
- `await pool.query(` - server/agent/thread-context.js:386
- `await db.insert(` - server/api/auth/auth.js:343
- `await db.insert(` - server/api/auth/auth.js:356
- `await db.insert(` - server/api/auth/auth.js:412
- `await db.insert(` - server/api/auth/auth.js:423
- `await db.update(` - server/api/auth/auth.js:580
- `await db.update(` - server/api/auth/auth.js:597
- `await db.update(` - server/api/auth/auth.js:622
- `await db.insert(` - server/api/auth/auth.js:634
- `await db.insert(` - server/api/auth/auth.js:771
- `await db.update(` - server/api/auth/auth.js:797
- `await db.update(` - server/api/auth/auth.js:898
- `await db.update(` - server/api/auth/auth.js:915
- `await db.update(` - server/api/auth/auth.js:1193
- `await db.update(` - server/api/auth/auth.js:1207
- `await db.update(` - server/api/auth/auth.js:1239
- `await db.select(` - server/api/briefing/briefing.js:168
- _... and 131 more_

### 3. Console log

- `console.log(`[Atlas/Claude] Using ${CLAUDE_MODEL} with ${CLAUD...)` - server/agent/agent-override-llm.js:33
- `console.log(`🔧 [Atlas Self-Healing] Resetting circuit breaker...)` - server/agent/agent-override-llm.js:64
- `console.log(`[Atlas] Using Claude Opus 4.6 (unified configurat...)` - server/agent/agent-override-llm.js:77
- `console.log(`✅ [Atlas] Claude succeeded in ${result.elapsed_ms...)` - server/agent/agent-override-llm.js:79
- `console.error(`❌ [Atlas] Claude failed:`, errorMsg)` - server/agent/agent-override-llm.js:89
- `console.error(`🚨 [Atlas Self-Healing] Circuit breaker triggered...)` - server/agent/agent-override-llm.js:96
- `console.error('[agent embed] ⛔ SECURITY ERROR: AGENT_ALLOWED_IPS...)` - server/agent/embed.js:29
- `console.warn(`[agent embed] ⛔ Blocked request from unauthorized...)` - server/agent/embed.js:37
- `console.error(`[agent embed] ⛔ Admin route blocked - no AGENT_AD...)` - server/agent/embed.js:60
- `console.warn(`[agent embed] ⚠️ Dev mode: allowing ${req.auth.us...)` - server/agent/embed.js:69
- `console.warn(`[agent embed] ⛔ Admin access denied for user ${re...)` - server/agent/embed.js:75
- `console.log(`[agent embed] ⚠️ Agent DISABLED (set AGENT_ENABLE...)` - server/agent/embed.js:91
- `console.log(`[agent embed] Mounting Agent at ${basePath}, WS a...)` - server/agent/embed.js:103
- `console.log(`[agent embed] ✅ Agent routes mounted at ${basePat...)` - server/agent/embed.js:108
- `console.log(`[agent embed] WS upgrade request for ${url}`)` - server/agent/embed.js:150
- `console.warn(`[agent embed] ⛔ WS upgrade rejected - no token pr...)` - server/agent/embed.js:157
- `console.warn(`[agent embed] ⛔ WS upgrade rejected - invalid tok...)` - server/agent/embed.js:166
- `console.log(`[agent embed] WS client connected from ${req.sock...)` - server/agent/embed.js:178
- `console.error('[agent embed] Ping error:', err.message)` - server/agent/embed.js:186
- `console.log(`[agent embed] Received: ${msg.substring(0, 100)` - server/agent/embed.js:195
- `console.error('[agent embed] Message error:', err.message)` - server/agent/embed.js:204
- `console.log('[agent embed] WS client disconnected')` - server/agent/embed.js:209
- `console.error('[agent embed] WS error:', err.message)` - server/agent/embed.js:214
- `console.log(`[agent embed] WebSocket server ready for ${wsPath...)` - server/agent/embed.js:226
- `console.warn('[Agent Enhanced Context] Failed to load recent sn...)` - server/agent/enhanced-context.js:121
- `console.warn(`[Agent Enhanced Context] Failed to load recent st...)` - server/agent/enhanced-context.js:135
- `console.warn('[Agent Enhanced Context] Failed to load recent ac...)` - server/agent/enhanced-context.js:147
- `console.warn('[Agent Enhanced Context] Failed to load preferenc...)` - server/agent/enhanced-context.js:162
- `console.warn('[Agent Enhanced Context] Failed to load session h...)` - server/agent/enhanced-context.js:176
- `console.warn('[Agent Enhanced Context] Failed to load project s...)` - server/agent/enhanced-context.js:190
- _... and 443 more_

---

## 2. Bootstrap & Init

### Files

- [server/bootstrap/enqueue-initial.js](./server/bootstrap/enqueue-initial.js) (active)
- [server/bootstrap/health.js](./server/bootstrap/health.js) (active)
- [server/bootstrap/middleware.js](./server/bootstrap/middleware.js) (active)
- [server/bootstrap/README.md](./server/bootstrap/README.md) (active) → UI: [README.md](./client/README.md)
- [server/bootstrap/routes.js](./server/bootstrap/routes.js) (active) → UI: [apiRoutes.ts](./client/src/constants/apiRoutes.ts)
- [server/bootstrap/workers.js](./server/bootstrap/workers.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)

### 2. API Call

#### 2.1 Resolved in memory

- `new Map(` - server/bootstrap/workers.js:10

#### 2.2 Resolved in db

- `await db.execute(` - server/bootstrap/enqueue-initial.js:16
- `await db.execute(` - server/bootstrap/enqueue-initial.js:28
- `await db.insert(` - server/bootstrap/enqueue-initial.js:42

### 3. Console log

- `console.log('[boot] Job seeding disabled (SEED_JOB_ON_BOOT not...)` - server/bootstrap/enqueue-initial.js:10
- `console.log(`[boot] ✓ ${queuedCount} queued jobs found, skippi...)` - server/bootstrap/enqueue-initial.js:23
- `console.log('[boot] ⚠️  No snapshots found, cannot seed job')` - server/bootstrap/enqueue-initial.js:35
- `console.log(`[boot] ✅ Seeded triad job for snapshot ${snapshot...)` - server/bootstrap/enqueue-initial.js:48
- `console.error('[boot] Failed to seed job:', err.message)` - server/bootstrap/enqueue-initial.js:50
- `console.log('[gateway] ✅ Health endpoints configured (/health,...)` - server/bootstrap/health.js:46
- `console.log('[gateway] ✅ Health API router mounted at /api/hea...)` - server/bootstrap/health.js:58
- `console.error('[gateway] ❌ Health router failed:', e?.message)` - server/bootstrap/health.js:61
- `console.log('[gateway] ✅ Bot blocker enabled (full protection)` - server/bootstrap/middleware.js:23
- `console.warn('[gateway] Bot blocker not available:', e?.message)` - server/bootstrap/middleware.js:25
- `console.warn('[gateway] Correlation ID middleware not available...)` - server/bootstrap/middleware.js:46
- `console.log('[gateway] ✅ Middleware configured')` - server/bootstrap/middleware.js:53
- `console.log('[gateway] Loading error middleware...')` - server/bootstrap/middleware.js:62
- `console.log('[gateway] ✅ Error middleware configured')` - server/bootstrap/middleware.js:66
- `console.error('[gateway] ❌ Error middleware failed:', e?.message)` - server/bootstrap/middleware.js:69
- `console.log(`[gateway] Loading ${description}...`)` - server/bootstrap/routes.js:19
- `console.log(`[gateway] ✅ ${description} mounted at ${routePath...)` - server/bootstrap/routes.js:23
- `console.error(`[gateway] ❌ ${description} failed:`, e?.message)` - server/bootstrap/routes.js:26
- `console.log('[gateway] Loading Agent embed...')` - server/bootstrap/routes.js:118
- `console.log('[gateway] ✅ Agent mounted at /agent')` - server/bootstrap/routes.js:127
- `console.error('[gateway] ❌ Agent embed failed:', e?.message)` - server/bootstrap/routes.js:130
- `console.log('[gateway] Loading SDK embed (catch-all fallback)` - server/bootstrap/routes.js:136
- `console.log('[gateway] ✅ SDK routes mounted at /api (catch-all...)` - server/bootstrap/routes.js:141
- `console.error('[gateway] ❌ SDK embed failed:', e?.message)` - server/bootstrap/routes.js:144
- `console.log('[gateway] Loading SSE strategy events...')` - server/bootstrap/routes.js:157
- `console.log('[gateway] ✅ SSE strategy events endpoint mounted')` - server/bootstrap/routes.js:161
- `console.error('[gateway] ❌ SSE events failed:', e?.message)` - server/bootstrap/routes.js:164
- `console.log('[gateway] ✅ Unified capabilities routes mounted')` - server/bootstrap/routes.js:178
- `console.error('[gateway] ❌ Unified capabilities routes failed:',...)` - server/bootstrap/routes.js:181
- `console.log(`[gateway] Starting ${name}...`)` - server/bootstrap/workers.js:26
- _... and 17 more_

---

## 3. Middleware

### Files

- [server/middleware/auth.js](./server/middleware/auth.js) (active) → UI: [oauth2.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/auth/oauth2.py)
- [server/middleware/bot-blocker.js](./server/middleware/bot-blocker.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/middleware/correlation-id.js](./server/middleware/correlation-id.js) (active)
- [server/middleware/error-handler.js](./server/middleware/error-handler.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/middleware/idempotency.js](./server/middleware/idempotency.js) (active)
- [server/middleware/learning-capture.js](./server/middleware/learning-capture.js) (active)
- [server/middleware/metrics.js](./server/middleware/metrics.js) (active)
- [server/middleware/rate-limit.js](./server/middleware/rate-limit.js) (active)
- [server/middleware/README.md](./server/middleware/README.md) (active) → UI: [README.md](./client/README.md)
- [server/middleware/require-snapshot-ownership.js](./server/middleware/require-snapshot-ownership.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/middleware/timeout.js](./server/middleware/timeout.js) (active)
- [server/middleware/validate.js](./server/middleware/validate.js) (active)
- [server/middleware/validation.js](./server/middleware/validation.js) (active)

### 2. API Call

#### 2.1 Resolved in memory

- `new Map(` - server/middleware/metrics.js:3
- `.map(` - server/middleware/metrics.js:18
- `.map(` - server/middleware/validate.js:40
- `.map(` - server/middleware/validation.js:69
- `.map(` - server/middleware/validation.js:76

#### 2.2 Resolved in db

- `await db.select(` - server/middleware/auth.js:153
- `await db.update(` - server/middleware/auth.js:179
- `await db.update(` - server/middleware/auth.js:193
- `db.update(` - server/middleware/auth.js:204
- `await db.select(` - server/middleware/idempotency.js:14
- `await db.insert(` - server/middleware/idempotency.js:40
- `await db.select(` - server/middleware/require-snapshot-ownership.js:35

### 3. Console log

- `console.warn('[auth] ⚠️ DEV MODE: VECTO_AGENT_SECRET not set, a...)` - server/middleware/auth.js:50
- `console.warn('[auth] Failed to update last_active_at:', err.mes...)` - server/middleware/auth.js:207
- `console.error('[auth] Session check failed:', sessionErr.message)` - server/middleware/auth.js:219
- `console.log(`[optionalAuth] ✅ Agent authenticated as ${agentUs...)` - server/middleware/auth.js:245
- `console.log(`[optionalAuth] ${path} - token: ${token ? 'presen...)` - server/middleware/auth.js:254
- `console.log(`[optionalAuth] ✅ Token verified for user ${payloa...)` - server/middleware/auth.js:261
- `console.log(`[optionalAuth] ❌ Token INVALID: ${e?.message} - r...)` - server/middleware/auth.js:264
- `console.log(`[optionalAuth] No token - proceeding as anonymous...)` - server/middleware/auth.js:269
- `console.log(`[bot-blocker] Blocked suspicious path: ${path} fr...)` - server/middleware/bot-blocker.js:143
- `console.log(`[bot-blocker] Blocked bot: "${userAgent.substring...)` - server/middleware/bot-blocker.js:149
- `console.log(`[bot-blocker] Blocked bot on API: "${userAgent.su...)` - server/middleware/bot-blocker.js:171
- `console.error('[error-handler] Unhandled error:', err)` - server/middleware/error-handler.js:29
- `console.warn('[idempotency] Failed to save response:', err.mess...)` - server/middleware/idempotency.js:46
- `console.error('[idempotency] Middleware error:', err)` - server/middleware/idempotency.js:67
- `console.log(`[learning] Captured: ${eventType}`, {       event...)` - server/middleware/learning-capture.js:39
- `console.error('[learning] Failed to capture event:', err.message)` - server/middleware/learning-capture.js:47
- `console.error('[learning] Middleware capture failed:', err.messa...)` - server/middleware/learning-capture.js:74
- `console.log(`[snapshotOwnership] ❌ No snapshotId provided`)` - server/middleware/require-snapshot-ownership.js:25
- `console.log(`[snapshotOwnership] ❌ No auth for snapshot ${snap...)` - server/middleware/require-snapshot-ownership.js:31
- `console.log(`[snapshotOwnership] ❌ Snapshot ${snapshotId.slice...)` - server/middleware/require-snapshot-ownership.js:39
- `console.log(`[snapshotOwnership] ❌ Snapshot ${snapshotId.slice...)` - server/middleware/require-snapshot-ownership.js:49
- `console.log(`[snapshotOwnership] ❌ User mismatch: auth=${req.a...)` - server/middleware/require-snapshot-ownership.js:54
- `console.error('[snapshotOwnership] Error:', error)` - server/middleware/require-snapshot-ownership.js:62
- `console.error(`[timeout] Request timeout after ${timeout}ms: ${r...)` - server/middleware/timeout.js:23
- `console.error(`[timeout] Response timeout after ${timeout}ms: ${...)` - server/middleware/timeout.js:37
- `console.warn(`[validation] ${req.method} ${req.path} failed:`, ...)` - server/middleware/validate.js:32
- `console.warn(`[validation] ZodError: ${errorSummary}`)` - server/middleware/validation.js:71

---

## 5. Core Logic

### Files

- [server/lib/ability-routes.js](./server/lib/ability-routes.js) (active) → UI: [routes.tsx](./client/src/routes.tsx)
- [server/lib/ai/adapters/anthropic-adapter.js](./server/lib/ai/adapters/anthropic-adapter.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/ai/adapters/anthropic-sonnet45.js](./server/lib/ai/adapters/anthropic-sonnet45.js) (active)
- [server/lib/ai/adapters/gemini-adapter.js](./server/lib/ai/adapters/gemini-adapter.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/ai/adapters/index.js](./server/lib/ai/adapters/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/ai/adapters/openai-adapter.js](./server/lib/ai/adapters/openai-adapter.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/ai/adapters/README.md](./server/lib/ai/adapters/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/ai/adapters/vertex-adapter.js](./server/lib/ai/adapters/vertex-adapter.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/ai/coach-dal.js](./server/lib/ai/coach-dal.js) (active)
- [server/lib/ai/index.js](./server/lib/ai/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/ai/model-registry.js](./server/lib/ai/model-registry.js) (active) → UI: [registry.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/Authlib/authlib/integrations/base_client/registry.pyi)
- [server/lib/ai/models-dictionary.js](./server/lib/ai/models-dictionary.js) (active)
- [server/lib/ai/providers/briefing.js](./server/lib/ai/providers/briefing.js) (active) → UI: [BriefingTab.tsx](./client/src/components/BriefingTab.tsx)
- [server/lib/ai/providers/consolidator.js](./server/lib/ai/providers/consolidator.js) (active)
- [server/lib/ai/providers/README.md](./server/lib/ai/providers/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/ai/README.md](./server/lib/ai/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/ai/unified-ai-capabilities.js](./server/lib/ai/unified-ai-capabilities.js) (active)
- [server/lib/anthropic-extended.d.ts](./server/lib/anthropic-extended.d.ts) (active)
- [server/lib/auth.js](./server/lib/auth.js) (active) → UI: [oauth2.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/auth/oauth2.py)
- [server/lib/auth/email.js](./server/lib/auth/email.js) (active)
- [server/lib/auth/index.js](./server/lib/auth/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/auth/password.js](./server/lib/auth/password.js) (active) → UI: [ForgotPasswordPage.tsx](./client/src/pages/auth/ForgotPasswordPage.tsx)
- [server/lib/auth/README.md](./server/lib/auth/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/auth/sms.js](./server/lib/auth/sms.js) (active)
- [server/lib/briefing/briefing-service.js](./server/lib/briefing/briefing-service.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/briefing/context-loader.js](./server/lib/briefing/context-loader.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/briefing/dump-last-briefing.js](./server/lib/briefing/dump-last-briefing.js) (active)
- [server/lib/briefing/dump-traffic-format.js](./server/lib/briefing/dump-traffic-format.js) (active) → UI: [form.tsx](./client/src/components/ui/form.tsx)
- [server/lib/briefing/event-schedule-validator.js](./server/lib/briefing/event-schedule-validator.js) (active)
- [server/lib/briefing/filter-for-planner.js](./server/lib/briefing/filter-for-planner.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/briefing/index.js](./server/lib/briefing/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/briefing/README.md](./server/lib/briefing/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/capabilities.js](./server/lib/capabilities.js) (active)
- [server/lib/change-analyzer/file-doc-mapping.js](./server/lib/change-analyzer/file-doc-mapping.js) (active) → UI: [App.css](./client/src/App.css)
- [server/lib/change-analyzer/README.md](./server/lib/change-analyzer/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/events/pipeline/hashEvent.js](./server/lib/events/pipeline/hashEvent.js) (active)
- [server/lib/events/pipeline/normalizeEvent.js](./server/lib/events/pipeline/normalizeEvent.js) (active)
- [server/lib/events/pipeline/README.md](./server/lib/events/pipeline/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/events/pipeline/types.js](./server/lib/events/pipeline/types.js) (active)
- [server/lib/events/pipeline/validateEvent.js](./server/lib/events/pipeline/validateEvent.js) (active)
- [server/lib/external/faa-asws.js](./server/lib/external/faa-asws.js) (active)
- [server/lib/external/index.js](./server/lib/external/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/external/perplexity-api.js](./server/lib/external/perplexity-api.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/external/README.md](./server/lib/external/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/external/routes-api.js](./server/lib/external/routes-api.js) (active) → UI: [routes.tsx](./client/src/routes.tsx)
- [server/lib/external/semantic-search.js](./server/lib/external/semantic-search.js) (active)
- [server/lib/external/serper-api.js](./server/lib/external/serper-api.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/external/streetview-api.js](./server/lib/external/streetview-api.js) (active)
- [server/lib/external/tts-handler.js](./server/lib/external/tts-handler.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/external/uber-client.js](./server/lib/external/uber-client.js) (active) → UI: [CLIENT.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/CLIENT.pyi)
- [server/lib/index.js](./server/lib/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/infrastructure/index.js](./server/lib/infrastructure/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/infrastructure/job-queue.js](./server/lib/infrastructure/job-queue.js) (active)
- [server/lib/infrastructure/README.md](./server/lib/infrastructure/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/jwt.ts](./server/lib/jwt.ts) (active)
- [server/lib/location/address-validation.js](./server/lib/location/address-validation.js) (active)
- [server/lib/location/coords-key.js](./server/lib/location/coords-key.js) (active)
- [server/lib/location/geo.js](./server/lib/location/geo.js) (active)
- [server/lib/location/geocode.js](./server/lib/location/geocode.js) (active)
- [server/lib/location/get-snapshot-context.js](./server/lib/location/get-snapshot-context.js) (active)
- [server/lib/location/getSnapshotTimeContext.js](./server/lib/location/getSnapshotTimeContext.js) (active)
- [server/lib/location/holiday-detector.js](./server/lib/location/holiday-detector.js) (active)
- [server/lib/location/index.js](./server/lib/location/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/location/README.md](./server/lib/location/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/location/validation-gates.js](./server/lib/location/validation-gates.js) (active)
- [server/lib/location/weather-traffic-validator.js](./server/lib/location/weather-traffic-validator.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/notifications/email-alerts.js](./server/lib/notifications/email-alerts.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/notifications/README.md](./server/lib/notifications/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/README.md](./server/lib/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/strategy/assert-safe.js](./server/lib/strategy/assert-safe.js) (active) → UI: [sse.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/sse.py)
- [server/lib/strategy/dump-last-strategy.js](./server/lib/strategy/dump-last-strategy.js) (active)
- [server/lib/strategy/index.js](./server/lib/strategy/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/strategy/planner-gpt5.js](./server/lib/strategy/planner-gpt5.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/strategy/providers.js](./server/lib/strategy/providers.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/strategy/README.md](./server/lib/strategy/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/strategy/status-constants.js](./server/lib/strategy/status-constants.js) (active)
- [server/lib/strategy/strategy-generator-parallel.js](./server/lib/strategy/strategy-generator-parallel.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/strategy/strategy-generator.js](./server/lib/strategy/strategy-generator.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/strategy/strategy-triggers.js](./server/lib/strategy/strategy-triggers.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/strategy/strategy-utils.js](./server/lib/strategy/strategy-utils.js) (active) → UI: [utils.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/auth/utils.py)
- [server/lib/strategy/strategyPrompt.js](./server/lib/strategy/strategyPrompt.js) (active)
- [server/lib/strategy/tactical-planner.js](./server/lib/strategy/tactical-planner.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/subagents/event-verifier.js](./server/lib/subagents/event-verifier.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/subagents/README.md](./server/lib/subagents/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/traffic/README.md](./server/lib/traffic/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/traffic/tomtom.js](./server/lib/traffic/tomtom.js) (active)
- [server/lib/venue/district-detection.js](./server/lib/venue/district-detection.js) (active)
- [server/lib/venue/enhanced-smart-blocks.js](./server/lib/venue/enhanced-smart-blocks.js) (active)
- [server/lib/venue/event-matcher.js](./server/lib/venue/event-matcher.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/venue/event-proximity-boost.js](./server/lib/venue/event-proximity-boost.js) (active)
- [server/lib/venue/hours/evaluator.js](./server/lib/venue/hours/evaluator.js) (active)
- [server/lib/venue/hours/index.js](./server/lib/venue/hours/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/venue/hours/normalized-types.js](./server/lib/venue/hours/normalized-types.js) (active)
- [server/lib/venue/hours/parsers/google-weekday-text.js](./server/lib/venue/hours/parsers/google-weekday-text.js) (active)
- [server/lib/venue/hours/parsers/hours-text-map.js](./server/lib/venue/hours/parsers/hours-text-map.js) (active)
- [server/lib/venue/hours/parsers/index.js](./server/lib/venue/hours/parsers/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/venue/hours/parsers/structured-hours.js](./server/lib/venue/hours/parsers/structured-hours.js) (active)
- [server/lib/venue/hours/README.md](./server/lib/venue/hours/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/venue/index.js](./server/lib/venue/index.js) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/lib/venue/README.md](./server/lib/venue/README.md) (active) → UI: [README.md](./client/README.md)
- [server/lib/venue/venue-address-resolver.js](./server/lib/venue/venue-address-resolver.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/venue/venue-cache.js](./server/lib/venue/venue-cache.js) (active)
- [server/lib/venue/venue-enrichment.js](./server/lib/venue/venue-enrichment.js) (active)
- [server/lib/venue/venue-event-verifier.js](./server/lib/venue/venue-event-verifier.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/lib/venue/venue-hours.js](./server/lib/venue/venue-hours.js) (active)
- [server/lib/venue/venue-intelligence.js](./server/lib/venue/venue-intelligence.js) (active)
- [server/lib/venue/venue-utils.js](./server/lib/venue/venue-utils.js) (active) → UI: [utils.py](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/mcp/client/auth/utils.py)

### 2. API Call

#### 2.1 Resolved in memory

- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/pyright-internal.js:1
- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/pyright-langserver.js:1
- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/pyright.js:1
- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/vendor.js:2
- `localStorage.` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1432
- `localStorage.` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1459
- `localStorage.` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1480
- `localStorage.` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1507
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:605
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:736
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1274
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1275
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1276
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1277
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1369
- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1280
- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1281
- `.reduce(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1282
- `.map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/jquery.min.js:2
- `new Map(` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/urllib3/contrib/emscripten/emscripten_fetch_worker.js:8
- `.reduce(` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/pyright/dist/dist/pyright-internal.js:1
- `.reduce(` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/pyright/dist/dist/pyright-langserver.js:1
- `.reduce(` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/pyright/dist/dist/pyright.js:1
- `.reduce(` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/pyright/dist/dist/vendor.js:2
- `localStorage.` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1432
- `localStorage.` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1459
- `localStorage.` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1480
- `localStorage.` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1507
- `.map(` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:605
- `.map(` - .cache/uv/archive-v0/2bT-oijANXByM7I2nusg7/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:736
- _... and 342 more_

#### 2.2 Resolved in db

- `db.select(` - server/lib/ai/coach-dal.js:270
- `db.select(` - server/lib/ai/coach-dal.js:273
- `await db.select(` - server/lib/ai/providers/briefing.js:206
- `await db.select(` - server/lib/ai/providers/consolidator.js:781
- `db.select(` - server/lib/ai/providers/consolidator.js:791
- `db.select(` - server/lib/ai/providers/consolidator.js:792
- `await db.update(` - server/lib/ai/providers/consolidator.js:969
- `await db.update(` - server/lib/ai/providers/consolidator.js:990
- `await db.select(` - server/lib/ai/providers/consolidator.js:1019
- `await db.select(` - server/lib/ai/providers/consolidator.js:1031
- `await db.select(` - server/lib/ai/providers/consolidator.js:1048
- `await db.update(` - server/lib/ai/providers/consolidator.js:1085
- `await db.update(` - server/lib/ai/providers/consolidator.js:1103
- `await db.insert(` - server/lib/briefing/briefing-service.js:1103
- `await db.select(` - server/lib/briefing/briefing-service.js:1145
- `await db.insert(` - server/lib/briefing/briefing-service.js:2084
- `await db.update(` - server/lib/briefing/briefing-service.js:2104
- `await db.select(` - server/lib/briefing/briefing-service.js:2128
- `await db.select(` - server/lib/briefing/briefing-service.js:2166
- `await db.select(` - server/lib/briefing/briefing-service.js:2265
- `await db.update(` - server/lib/briefing/briefing-service.js:2268
- `await db.insert(` - server/lib/briefing/briefing-service.js:2281
- `await db.execute(` - server/lib/briefing/briefing-service.js:2288
- `await db.select(` - server/lib/briefing/briefing-service.js:2315
- `await db.update(` - server/lib/briefing/briefing-service.js:2424
- `await db.update(` - server/lib/briefing/briefing-service.js:2457
- `await db.update(` - server/lib/briefing/briefing-service.js:2491
- `await db.select(` - server/lib/briefing/context-loader.js:53
- `await db.select(` - server/lib/briefing/context-loader.js:72
- `await db.select(` - server/lib/briefing/context-loader.js:134
- _... and 39 more_

### 3. Console log

- `console.info(n)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/pyright-internal.js:1
- `console.error(A)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/vendor.js:2
- `console.log("updating theme-aware image to theme:", theme)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:48
- `console.log('Banners loaded:', response)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:80
- `console.error('Error loading banners:', error)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:110
- `console.error('Heartbeat failure; count = ', self.heartbeatFailu...)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:422
- `console.log('Server appears to be down, closing tab')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:424
- `console.log('Still waiting for previous config poll result, sk...)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:486
- `console.log('Polling for config overview...')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:490
- `console.log('Config has changed, updating display')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:501
- `console.log('Config unchanged, skipping display update')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:513
- `console.error('Error loading config overview:', error)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:516
- `console.error('Error in displayConfig:', error)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:720
- `console.error('Error loading executions:', response.message)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:826
- `console.error('Error loading executions:', error)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:829
- `console.error('Error loading last execution:', response.message)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:844
- `console.error('Error loading last execution:', error)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:847
- `console.log('Still waiting for previous executions poll result...)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:855
- `console.log('Polling for executions...')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:858
- `console.log('Cancel button clicked')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:912
- `console.log('Found item:', $item.length)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:914
- `console.log('Execution data string:', executionDataStr)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:916
- `console.log('Parsed execution data:', executionData)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:921
- `console.error('No execution data found on element')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:924
- `console.log('confirmCancelExecution called with:', executionDa...)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:988
- `console.log('Showing modal for running execution')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:993
- `console.log('Directly cancelling queued execution')` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:997
- `console.log('cancelExecution called with full execution data:'...)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1012
- `console.log('Attempting to cancel task:', executionData.task_i...)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1013
- `console.log('Cancel task response:', response)` - .cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/serena/resources/dashboard/dashboard.js:1020
- _... and 883 more_

---

## 6. LLM Adapters

### Files


---

## 7. Database

### Files

- [server/db/001_init.sql](./server/db/001_init.sql) (active)
- [server/db/002_seed_dfw.sql](./server/db/002_seed_dfw.sql) (active)
- [server/db/connection-manager.js](./server/db/connection-manager.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/db/db-client.js](./server/db/db-client.js) (active) → UI: [CLIENT.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/CLIENT.pyi)
- [server/db/drizzle-lazy.js](./server/db/drizzle-lazy.js) (active)
- [server/db/drizzle.js](./server/db/drizzle.js) (active)
- [server/db/migrations/2026-01-10-d013-places-cache-rename.sql](./server/db/migrations/2026-01-10-d013-places-cache-rename.sql) (active)
- [server/db/migrations/2026-01-10-rename-event-fields.sql](./server/db/migrations/2026-01-10-rename-event-fields.sql) (active)
- [server/db/pool.js](./server/db/pool.js) (active)
- [server/db/README.md](./server/db/README.md) (active) → UI: [README.md](./client/README.md)
- [server/db/rls-middleware.js](./server/db/rls-middleware.js) (active)
- [server/db/sql/2025-10-31_strategy_generic.sql](./server/db/sql/2025-10-31_strategy_generic.sql) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/db/sql/2025-11-03_blocks_ready_notify.sql](./server/db/sql/2025-11-03_blocks_ready_notify.sql) (active)
- [server/db/sql/2025-12-27_event_deactivation_fields.sql](./server/db/sql/2025-12-27_event_deactivation_fields.sql) (active)
- [server/db/sql/README.md](./server/db/sql/README.md) (active) → UI: [README.md](./client/README.md)
- [migrations/001_init.sql](./migrations/001_init.sql) (not active)
- [migrations/002_memory_tables.sql](./migrations/002_memory_tables.sql) (not active) → UI: [table.tsx](./client/src/components/ui/table.tsx)
- [migrations/003_rls_security.sql](./migrations/003_rls_security.sql) (not active)
- [migrations/004_jwt_helpers.sql](./migrations/004_jwt_helpers.sql) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [migrations/20251103_add_strategy_notify.sql](./migrations/20251103_add_strategy_notify.sql) (not active)
- [migrations/20251209_drop_unused_briefing_columns.sql](./migrations/20251209_drop_unused_briefing_columns.sql) (not active)
- [migrations/20251209_fix_strategy_notify.sql](./migrations/20251209_fix_strategy_notify.sql) (not active)
- [migrations/20251214_add_event_end_time.sql](./migrations/20251214_add_event_end_time.sql) (not active)
- [migrations/20251214_discovered_events.sql](./migrations/20251214_discovered_events.sql) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [migrations/20251228_auth_system_tables.sql](./migrations/20251228_auth_system_tables.sql) (not active) → UI: [table.tsx](./client/src/components/ui/table.tsx)
- [migrations/20251228_drop_snapshot_user_device.sql](./migrations/20251228_drop_snapshot_user_device.sql) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [migrations/20251229_district_tagging.sql](./migrations/20251229_district_tagging.sql) (not active)
- [migrations/20260109_briefing_ready_notify.sql](./migrations/20260109_briefing_ready_notify.sql) (not active)
- [migrations/20260110_cleanup_invalid_events.sql](./migrations/20260110_cleanup_invalid_events.sql) (not active) → UI: [events.ts](./client/src/constants/events.ts)
- [migrations/20260110_drop_discovered_events_unused_cols.sql](./migrations/20260110_drop_discovered_events_unused_cols.sql) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [migrations/20260110_fix_strategy_now_notify.sql](./migrations/20260110_fix_strategy_now_notify.sql) (not active)
- [migrations/20260110_rename_event_columns.sql](./migrations/20260110_rename_event_columns.sql) (not active)
- [migrations/20260114_create_places_cache.sql](./migrations/20260114_create_places_cache.sql) (not active) → UI: [CR.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/CR.pyi)
- [migrations/20260114_lean_strategies_table.sql](./migrations/20260114_lean_strategies_table.sql) (not active) → UI: [table.tsx](./client/src/components/ui/table.tsx)
- [migrations/20260114_progressive_enrichment.sql](./migrations/20260114_progressive_enrichment.sql) (not active) → UI: [progress.tsx](./client/src/components/ui/progress.tsx)
- [migrations/manual/20251006_add_perf_indexes.sql](./migrations/manual/20251006_add_perf_indexes.sql) (not active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [migrations/manual/20251007_add_fk_cascade.sql](./migrations/manual/20251007_add_fk_cascade.sql) (not active)
- [migrations/manual/20251007_fk_cascade_fix.sql](./migrations/manual/20251007_fk_cascade_fix.sql) (not active)
- [migrations/manual/README.md](./migrations/manual/README.md) (not active) → UI: [README.md](./client/README.md)
- [migrations/README.md](./migrations/README.md) (not active) → UI: [README.md](./client/README.md)

### 1. Schema

#### 1.1 assistant_memory

- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 WITH
- 1.1.1 updated_at
- 1.1.1 expires_at

_Source: migrations/002_memory_tables.sql_

#### 1.1 auth_credentials

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 password_hash
- 1.1.1 failed_login_attempts
- 1.1.1 locked_until
- 1.1.1 last_login_at
- 1.1.1 last_login_ip
- 1.1.1 password_reset_token
- 1.1.1 password_reset_expires
- 1.1.1 password_changed_at
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: migrations/20251228_auth_system_tables.sql_

#### 1.1 blocks_catalog

- 1.1.1 id
- 1.1.1 region
- 1.1.1 slug
- 1.1.1 name
- 1.1.1 address
- 1.1.1 meta

_Source: server/db/001_init.sql_

#### 1.1 coords_cache

- 1.1.1 id
- 1.1.1 coord_key
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 country
- 1.1.1 timezone
- 1.1.1 closest_airport
- 1.1.1 closest_airport_code
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 hit_count

_Source: drizzle/0012_fantastic_puff_adder.sql_

#### 1.1 cross_thread_memory

- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 WITH
- 1.1.1 updated_at
- 1.1.1 expires_at

_Source: migrations/002_memory_tables.sql_

#### 1.1 discovered_events

- 1.1.1 id
- 1.1.1 title
- 1.1.1 venue_name
- 1.1.1 address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 zip
- 1.1.1 event_date
- 1.1.1 event_time
- 1.1.1 event_end_date
- 1.1.1 category
- 1.1.1 expected_attendance
- 1.1.1 source_model
- 1.1.1 source_url
- 1.1.1 raw_source_data
- 1.1.1 event_hash
- 1.1.1 discovered_at
- 1.1.1 updated_at
- 1.1.1 is_verified
- 1.1.1 is_active

_Source: migrations/20251214_discovered_events.sql_

#### 1.1 documents

- 1.1.1 id
- 1.1.1 content
- 1.1.1 metadata
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: migrations/001_init.sql_

#### 1.1 driver_profiles

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 first_name
- 1.1.1 last_name
- 1.1.1 email
- 1.1.1 phone
- 1.1.1 address_1
- 1.1.1 address_2
- 1.1.1 city
- 1.1.1 state_territory
- 1.1.1 zip_code
- 1.1.1 country
- 1.1.1 market
- 1.1.1 rideshare_platforms
- 1.1.1 uber_black
- 1.1.1 uber_xxl
- 1.1.1 uber_comfort
- 1.1.1 uber_x
- 1.1.1 uber_x_share
- 1.1.1 marketing_opt_in
- 1.1.1 terms_accepted_at
- 1.1.1 terms_version
- 1.1.1 email_verified
- 1.1.1 phone_verified
- 1.1.1 profile_complete
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: migrations/20251228_auth_system_tables.sql_

#### 1.1 driver_vehicles

- 1.1.1 id
- 1.1.1 driver_profile_id
- 1.1.1 year
- 1.1.1 make
- 1.1.1 model
- 1.1.1 color
- 1.1.1 license_plate
- 1.1.1 seatbelts
- 1.1.1 is_primary
- 1.1.1 is_active
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: migrations/20251228_auth_system_tables.sql_

#### 1.1 eidolon_memory

- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 WITH
- 1.1.1 updated_at
- 1.1.1 expires_at

_Source: migrations/002_memory_tables.sql_

#### 1.1 eidolon_snapshots

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 user_id
- 1.1.1 session_id
- 1.1.1 scope
- 1.1.1 state
- 1.1.1 metadata
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 updated_at
- 1.1.1 expires_at

_Source: drizzle/0011_sad_firestar.sql_

#### 1.1 nearby_venues

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 name
- 1.1.1 venue_type
- 1.1.1 address
- 1.1.1 expense_level
- 1.1.1 expense_rank
- 1.1.1 is_open
- 1.1.1 hours_today
- 1.1.1 closing_soon
- 1.1.1 minutes_until_close
- 1.1.1 crowd_level
- 1.1.1 rideshare_potential
- 1.1.1 city
- 1.1.1 state
- 1.1.1 search_sources
- 1.1.1 created_at
- 1.1.1 with

_Source: drizzle/0008_good_namor.sql_

#### 1.1 places_cache

- 1.1.1 coords_key
- 1.1.1 formatted_hours
- 1.1.1 cached_at
- 1.1.1 access_count

_Source: migrations/20260114_create_places_cache.sql_

#### 1.1 policies

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 region
- 1.1.1 name
- 1.1.1 is_active
- 1.1.1 rules
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: server/db/001_init.sql_

#### 1.1 traffic_zones

- 1.1.1 id
- 1.1.1 city
- 1.1.1 state
- 1.1.1 traffic_density
- 1.1.1 density_level
- 1.1.1 congestion_areas
- 1.1.1 high_demand_zones
- 1.1.1 driver_advice
- 1.1.1 sources
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 expires_at

_Source: drizzle/0008_good_namor.sql_

#### 1.1 users

- 1.1.1 user_id
- 1.1.1 device_id
- 1.1.1 session_id
- 1.1.1 coord_source
- 1.1.1 formatted_address
- 1.1.1 city
- 1.1.1 state
- 1.1.1 country
- 1.1.1 timezone
- 1.1.1 local_iso
- 1.1.1 dow
- 1.1.1 hour
- 1.1.1 day_part_key
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 updated_at

_Source: drizzle/0003_bouncy_cobalt_man.sql_

#### 1.1 vehicle_makes_cache

- 1.1.1 id
- 1.1.1 make_id
- 1.1.1 make_name
- 1.1.1 is_common
- 1.1.1 cached_at

_Source: migrations/20251228_auth_system_tables.sql_

#### 1.1 vehicle_models_cache

- 1.1.1 id
- 1.1.1 make_id
- 1.1.1 make_name
- 1.1.1 model_id
- 1.1.1 model_name
- 1.1.1 model_year
- 1.1.1 cached_at

_Source: migrations/20251228_auth_system_tables.sql_

#### 1.1 verification_codes

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 code
- 1.1.1 code_type
- 1.1.1 destination
- 1.1.1 used_at
- 1.1.1 expires_at
- 1.1.1 attempts
- 1.1.1 max_attempts
- 1.1.1 created_at

_Source: migrations/20251228_auth_system_tables.sql_

### 2. API Call

#### 2.1 Resolved in memory

- `new Map(` - server/db/db-client.js:199

#### 2.2 Resolved in db

- `pool.query(` - server/db/connection-manager.js:52
- `client.query(` - server/db/connection-manager.js:29
- `await client.query(` - server/db/db-client.js:216
- `await client.query(` - server/db/rls-middleware.js:35
- `await client.query(` - server/db/rls-middleware.js:39
- `await client.query(` - server/db/rls-middleware.js:43
- `await client.query(` - server/db/rls-middleware.js:49
- `await client.query(` - server/db/rls-middleware.js:50
- `await client.query(` - server/db/rls-middleware.js:85
- `await client.query(` - server/db/rls-middleware.js:89
- `await client.query(` - server/db/rls-middleware.js:93
- `await client.query(` - server/db/rls-middleware.js:99
- `await client.query(` - server/db/rls-middleware.js:103

### 3. Console log

- `console.error("❌ Fatal: DATABASE_URL is missing. Ensure Replit P...)` - server/db/connection-manager.js:8
- `console.warn(`⚠️ Connection pool nearing capacity: ${stats.tota...)` - server/db/connection-manager.js:42
- `console.error('Unexpected error on idle client', err)` - server/db/connection-manager.js:48
- `console.error(`[NotificationDispatcher] Subscriber error:`, err)` - server/db/db-client.js:236
- `console.error('[RLS] Client error:', err.message)` - server/db/rls-middleware.js:28
- `console.warn('[RLS] Failed to reset session variables:', err.me...)` - server/db/rls-middleware.js:52
- `console.error('[RLS] Transaction client error:', err.message)` - server/db/rls-middleware.js:80

---

## 8. Background Jobs

### Files

- [server/jobs/change-analyzer-job.js](./server/jobs/change-analyzer-job.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/jobs/event-cleanup.js](./server/jobs/event-cleanup.js) (active)
- [server/jobs/event-sync-job.js](./server/jobs/event-sync-job.js) (active)
- [server/jobs/README.md](./server/jobs/README.md) (active) → UI: [README.md](./client/README.md)
- [server/jobs/triad-worker.js](./server/jobs/triad-worker.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)

### 2. API Call

#### 2.1 Resolved in memory

- `.filter(` - server/jobs/change-analyzer-job.js:73
- `.map(` - server/jobs/change-analyzer-job.js:123
- `.map(` - server/jobs/change-analyzer-job.js:145

#### 2.2 Resolved in db

- `await pool.query(` - server/jobs/event-cleanup.js:37
- `await db.execute(` - server/jobs/event-sync-job.js:32
- `await db.select(` - server/jobs/triad-worker.js:75
- `await db.select(` - server/jobs/triad-worker.js:86
- `await db.select(` - server/jobs/triad-worker.js:108

### 3. Console log

- `console.log('[ChangeAnalyzer] Analysis already running, skippi...)` - server/jobs/change-analyzer-job.js:46
- `console.log('[ChangeAnalyzer] Skipped - not a git repository (...)` - server/jobs/change-analyzer-job.js:53
- `console.log('[ChangeAnalyzer] Starting analysis...')` - server/jobs/change-analyzer-job.js:61
- `console.log(`[ChangeAnalyzer] ✅ Complete (${duration}ms)` - server/jobs/change-analyzer-job.js:96
- `console.error('[ChangeAnalyzer] ❌ Error:', err.message)` - server/jobs/change-analyzer-job.js:108
- `console.warn('[ChangeAnalyzer] Could not get uncommitted change...)` - server/jobs/change-analyzer-job.js:129
- `console.warn('[ChangeAnalyzer] Could not get recent commits:', ...)` - server/jobs/change-analyzer-job.js:154
- `console.log(`[ChangeAnalyzer] Written to ${dailyLogPath} and p...)` - server/jobs/change-analyzer-job.js:365
- `console.log('[ChangeAnalyzer] Initializing...')` - server/jobs/change-analyzer-job.js:373
- `console.log('[ChangeAnalyzer] Disabled via RUN_CHANGE_ANALYZER...)` - server/jobs/change-analyzer-job.js:379
- `console.error('[ChangeAnalyzer] Initial analysis failed:', err.m...)` - server/jobs/change-analyzer-job.js:389
- `console.log('[ChangeAnalyzer] Stopped')` - server/jobs/change-analyzer-job.js:397
- `console.log('[event-cleanup] Cleanup already in progress, skip...)` - server/jobs/event-cleanup.js:22
- `console.log('[event-cleanup] Shared pool not available, skippi...)` - server/jobs/event-cleanup.js:32
- `console.log(`[event-cleanup] ✅ Cleaned up ${deletedCount} expi...)` - server/jobs/event-cleanup.js:42
- `console.log(`[event-cleanup] No expired events to clean up (${...)` - server/jobs/event-cleanup.js:44
- `console.log('[event-cleanup] events_facts table not found, ski...)` - server/jobs/event-cleanup.js:52
- `console.log('[event-cleanup] Cleanup function not found, skipp...)` - server/jobs/event-cleanup.js:54
- `console.error('[event-cleanup] ❌ Cleanup failed:', err.message)` - server/jobs/event-cleanup.js:58
- `console.log('[event-cleanup] Cleanup disabled via EVENT_CLEANU...)` - server/jobs/event-cleanup.js:71
- `console.log('[event-cleanup] Cleanup loop already running')` - server/jobs/event-cleanup.js:76
- `console.log(`[event-cleanup] Starting cleanup loop (every ${in...)` - server/jobs/event-cleanup.js:81
- `console.error('[event-cleanup] Initial cleanup failed:', err.mes...)` - server/jobs/event-cleanup.js:85
- `console.error('[event-cleanup] Scheduled cleanup failed:', err.m...)` - server/jobs/event-cleanup.js:91
- `console.log('[event-cleanup] Cleanup loop stopped')` - server/jobs/event-cleanup.js:106
- `console.log('[EventSync] Sync already in progress, skipping......)` - server/jobs/event-sync-job.js:69
- `console.log('═════════════════════════════════════════════════...)` - server/jobs/event-sync-job.js:76
- `console.log('[EventSync] DAILY EVENT SYNC STARTED')` - server/jobs/event-sync-job.js:77
- `console.log(`[EventSync] Time: ${new Date()` - server/jobs/event-sync-job.js:78
- `console.log('═════════════════════════════════════════════════...)` - server/jobs/event-sync-job.js:79
- _... and 43 more_

---

## 9. Eidolon SDK

### Files

- [server/eidolon/config.ts](./server/eidolon/config.ts) (active)
- [server/eidolon/core/code-map.ts](./server/eidolon/core/code-map.ts) (active)
- [server/eidolon/core/context-awareness.ts](./server/eidolon/core/context-awareness.ts) (active)
- [server/eidolon/core/deep-thinking-engine.ts](./server/eidolon/core/deep-thinking-engine.ts) (active)
- [server/eidolon/core/deployment-tracker.ts](./server/eidolon/core/deployment-tracker.ts) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/eidolon/core/llm.ts](./server/eidolon/core/llm.ts) (active)
- [server/eidolon/core/memory-enhanced.ts](./server/eidolon/core/memory-enhanced.ts) (active)
- [server/eidolon/core/memory-store.ts](./server/eidolon/core/memory-store.ts) (active)
- [server/eidolon/core/README.md](./server/eidolon/core/README.md) (active) → UI: [README.md](./client/README.md)
- [server/eidolon/enhanced-context.js](./server/eidolon/enhanced-context.js) (active)
- [server/eidolon/index.ts](./server/eidolon/index.ts) (active) → UI: [index-BfAOqFWl.css](./client/dist/assets/index-BfAOqFWl.css)
- [server/eidolon/memory/compactor.js](./server/eidolon/memory/compactor.js) (active)
- [server/eidolon/memory/pg.js](./server/eidolon/memory/pg.js) (active)
- [server/eidolon/memory/README.md](./server/eidolon/memory/README.md) (active) → UI: [README.md](./client/README.md)
- [server/eidolon/policy-loader.js](./server/eidolon/policy-loader.js) (active) → UI: [ER.pyi](./.cache/uv/archive-v0/-sZijmBbxxXsCA3ulYDD6/lib/python3.11/site-packages/pyright/dist/dist/typeshed-fallback/stubs/mysqlclient/MySQLdb/constants/ER.pyi)
- [server/eidolon/policy-middleware.js](./server/eidolon/policy-middleware.js) (active)
- [server/eidolon/README.md](./server/eidolon/README.md) (active) → UI: [README.md](./client/README.md)

### 2. API Call

#### 2.1 Resolved in memory

- `.map(` - server/eidolon/core/code-map.ts:131
- `.filter(` - server/eidolon/core/context-awareness.ts:134
- `.filter(` - server/eidolon/core/context-awareness.ts:308
- `.filter(` - server/eidolon/core/context-awareness.ts:361
- `.map(` - server/eidolon/core/context-awareness.ts:370
- `.map(` - server/eidolon/core/deep-thinking-engine.ts:190
- `.map(` - server/eidolon/core/deep-thinking-engine.ts:237
- `.reduce(` - server/eidolon/core/deep-thinking-engine.ts:110
- `.filter(` - server/eidolon/core/deployment-tracker.ts:121
- `.filter(` - server/eidolon/core/deployment-tracker.ts:122
- `.filter(` - server/eidolon/core/llm.ts:46
- `.map(` - server/eidolon/core/llm.ts:94
- `.filter(` - server/eidolon/core/memory-enhanced.ts:77
- `.filter(` - server/eidolon/core/memory-enhanced.ts:90
- `.filter(` - server/eidolon/core/memory-enhanced.ts:132
- `.filter(` - server/eidolon/core/memory-enhanced.ts:133
- `.filter(` - server/eidolon/core/memory-store.ts:31
- `.filter(` - server/eidolon/core/memory-store.ts:49
- `.filter(` - server/eidolon/core/memory-store.ts:59
- `.map(` - server/eidolon/core/memory-store.ts:60
- `.map(` - server/eidolon/enhanced-context.js:110
- `.map(` - server/eidolon/enhanced-context.js:125
- `.map(` - server/eidolon/enhanced-context.js:139
- `.map(` - server/eidolon/enhanced-context.js:158
- `.map(` - server/eidolon/enhanced-context.js:172
- `.map(` - server/eidolon/enhanced-context.js:186
- `.map(` - server/eidolon/enhanced-context.js:199
- `.map(` - server/eidolon/enhanced-context.js:486
- `.map(` - server/eidolon/enhanced-context.js:505
- `.map(` - server/eidolon/memory/pg.js:140

#### 2.2 Resolved in db

- `await db.select(` - server/eidolon/enhanced-context.js:109
- `await db.select(` - server/eidolon/enhanced-context.js:124
- `await db.select(` - server/eidolon/enhanced-context.js:138
- `await db.execute(` - server/eidolon/enhanced-context.js:386
- `await db.execute(` - server/eidolon/enhanced-context.js:411
- `await db.select(` - server/eidolon/enhanced-context.js:427
- `await pool.query(` - server/eidolon/enhanced-context.js:459
- `await pool.query(` - server/eidolon/enhanced-context.js:496
- `await pool.query(` - server/eidolon/memory/pg.js:153
- `await client.query(` - server/eidolon/memory/pg.js:54
- `await client.query(` - server/eidolon/memory/pg.js:66
- `await client.query(` - server/eidolon/memory/pg.js:99
- `await client.query(` - server/eidolon/memory/pg.js:138

### 3. Console log

- `console.warn(`Cannot scan directory ${dir}:`, err)` - server/eidolon/core/code-map.ts:37
- `console.warn(`Cannot scan file ${filePath}:`, err)` - server/eidolon/core/code-map.ts:53
- `console.warn('Could not persist code map:', err)` - server/eidolon/core/code-map.ts:172
- `console.warn('Could not scan components:', err)` - server/eidolon/core/context-awareness.ts:86
- `console.log(`🧠 [DeepThinking] Starting comprehensive analysis...)` - server/eidolon/core/deep-thinking-engine.ts:8
- `console.log(`✅ [DeepThinking] Reached confidence threshold at ...)` - server/eidolon/core/deep-thinking-engine.ts:33
- `console.log(`🎯 [DeepThinking] Analysis complete. Confidence: ...)` - server/eidolon/core/deep-thinking-engine.ts:41
- `console.warn(`Could not delete memory ${name}:`, err)` - server/eidolon/core/memory-store.ts:62
- `console.warn('[Eidolon Enhanced Context] Failed to load recent ...)` - server/eidolon/enhanced-context.js:120
- `console.warn(`[Eidolon Enhanced Context] Failed to load recent ...)` - server/eidolon/enhanced-context.js:134
- `console.warn('[Eidolon Enhanced Context] Failed to load recent ...)` - server/eidolon/enhanced-context.js:146
- `console.warn('[Eidolon Enhanced Context] Failed to load prefere...)` - server/eidolon/enhanced-context.js:161
- `console.warn('[Eidolon Enhanced Context] Failed to load session...)` - server/eidolon/enhanced-context.js:175
- `console.warn('[Eidolon Enhanced Context] Failed to load project...)` - server/eidolon/enhanced-context.js:189
- `console.warn('[Eidolon Enhanced Context] Failed to load convers...)` - server/eidolon/enhanced-context.js:201
- `console.warn('[Eidolon Enhanced Context] Failed to store agent ...)` - server/eidolon/enhanced-context.js:473
- `console.warn('[Eidolon Enhanced Context] Failed to load agent m...)` - server/eidolon/enhanced-context.js:515
- `console.info("[memory] compaction complete")` - server/eidolon/memory/compactor.js:12
- `console.error("[memory] compaction error:", e?.message || e)` - server/eidolon/memory/compactor.js:14
- `console.warn('[memory] Shared pool unavailable - creating fallb...)` - server/eidolon/memory/pg.js:11
- `console.error('[memory:put] Client error:', err.message)` - server/eidolon/memory/pg.js:40
- `console.error('[memory:get] Client error:', err.message)` - server/eidolon/memory/pg.js:81
- `console.error('[memory:query] Client error:', err.message)` - server/eidolon/memory/pg.js:120
- `console.warn(`[policy] Could not load from ${path}: ${e.message...)` - server/eidolon/policy-loader.js:13
- `console.log('[eidolon policy] Configuration loaded:', {       ...)` - server/eidolon/policy-middleware.js:8

---

## Workflow Summary

| Subcategory | Files | Active | Not Active | Schemas | API Calls | Console Logs |
|-------------|-------|--------|------------|---------|-----------|-------------|
| 1. Entry Points | 3 | 3 | 0 | 0 | 2 | 51 |
| 10. Gateway | 2 | 2 | 0 | 0 | 0 | 1 |
| 11. Scripts & Utils | 94 | 19 | 75 | 17 | 169 | 674 |
| 12. Shared | 37 | 37 | 0 | 51 | 9 | 9 |
| 13. Other Workflow | 168 | 168 | 0 | 0 | 312 | 473 |
| 2. Bootstrap & Init | 6 | 6 | 0 | 0 | 5 | 47 |
| 3. Middleware | 367 | 73 | 294 | 0 | 13 | 27 |
| 5. Core Logic | 67072 | 1259 | 65813 | 0 | 5207 | 2553 |
| 6. LLM Adapters | 12 | 12 | 0 | 0 | 0 | 0 |
| 7. Database | 53 | 15 | 38 | 19 | 15 | 7 |
| 8. Background Jobs | 5 | 5 | 0 | 0 | 8 | 73 |
| 9. Eidolon SDK | 17 | 17 | 0 | 0 | 43 | 25 |
