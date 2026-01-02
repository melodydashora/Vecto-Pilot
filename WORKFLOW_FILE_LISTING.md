# Workflow File Listing

Generated: 2026-01-02T12:00:00.000Z
**Last Review:** 2026-01-02 UTC

> ✅ **Updated:** This file reflects the current repository structure as of January 1, 2026:
> - **Authentication System:** Full JWT-based auth with sign-up, sign-in, verification, password reset
> - **Server Organization:** Domain-based folders (`server/lib/ai/`, `server/lib/auth/`, `server/lib/briefing/`, etc.)
> - **API Routes:** Organized by domain in `server/api/` (auth, briefing, chat, feedback, health, intelligence, location, platform, research, strategy, vehicle, venue)
> - **Client Architecture:** React Router with 13 pages (8 co-pilot + 5 auth + SafeScaffold)
> - **Route Protection:** `ProtectedRoute` wrapper, `AuthRedirect` for smart routing
> - **Providers:** AuthProvider, CoPilotProvider, LocationProvider in App.tsx
> - **Bootstrap System:** Separated into `server/bootstrap/` for route mounting, middleware, workers
> - **Documentation:** 95+ README files across all folders

Workflow files organized by event flow order. Non-active files appear at the end of each category.

---

## 1. Entry Points

### Files

- [agent-server.js](./agent-server.js) (active)
- [gateway-server.js](./gateway-server.js) (active)
- [index.js](./index.js) (active) → UI: [index-BzKHz2OF.js](./client/dist/assets/index-BzKHz2OF.js)

### 2. API Call

#### 2.1 Resolved in memory

- `new Map(` - gateway-server.js:36
- `new Map(` - index.js:358
- `new Map(` - index.js:601
- `new Map(` - index.js:602
- `new Map(` - index.js:608
- `new Map(` - index.js:611
- `.filter(` - index.js:163
- `.filter(` - index.js:490
- `.filter(` - index.js:671
- `.filter(` - index.js:672
- `.filter(` - index.js:673
- `.filter(` - index.js:674
- `.filter(` - index.js:675
- `.filter(` - index.js:1533
- `.map(` - index.js:165
- `.map(` - index.js:680
- `.map(` - index.js:744

#### 2.2 Resolved in db

- `await pool.query(` - agent-server.js:417
- `await pool.query(` - agent-server.js:441
- `await pool.query(` - index.js:1168

### 3. Console log

- `console.log('[agent] Using local pool (shared pool disabled)` - agent-server.js:71
- `console.error(`Failed to write log: ${err.message}`)` - agent-server.js:157
- `console.log(`[agent] Listening on ${HOST}:${PORT}`)` - agent-server.js:657
- `console.log(`[agent] Base directory: ${BASE_DIR}`)` - agent-server.js:658
- `console.log(`[agent] Environment: ${IS_REPLIT ? "REPLIT" : "LO...)` - agent-server.js:659
- `console.log(`[agent] Token auth: enabled`)` - agent-server.js:660
- `console.error(`[agent] ERROR: Port ${PORT} is already in use!`)` - agent-server.js:666
- `console.error(`[agent] Another process is using port ${PORT}. Ex...)` - agent-server.js:667
- `console.log("[agent] Shutting down…")` - agent-server.js:678
- `console.log(`[gateway] PID: ${process.pid}`)` - gateway-server.js:32
- `console.log(`[gateway] Mode: ${MODE.toUpperCase()` - gateway-server.js:33
- `console.log("[gateway] AI Config:", GATEWAY_CONFIG)` - gateway-server.js:34
- `console.log(`🐕 [gateway] Starting ${name}...`)` - gateway-server.js:38
- `console.log(`[${name}] ${data.toString()` - gateway-server.js:43
- `console.error(`[${name}] ${data.toString()` - gateway-server.js:44
- `console.error(`❌ [gateway] ${name} exited with code ${code}, res...)` - gateway-server.js:46
- `console.log(`[ready] Server listening on 0.0.0.0:${PORT}`)` - gateway-server.js:80
- `console.log("[gateway] 🎧 Consolidation listener started")` - gateway-server.js:87
- `console.error("[gateway] ❌ Listener failed:", err?.message || er...)` - gateway-server.js:88
- `console.log("[gateway] 🧹 Event cleanup job started")` - gateway-server.js:95
- `console.error("[mono] SDK embed failed:", e?.message)` - gateway-server.js:110
- `console.error("[mono] Agent embed failed:", e?.message)` - gateway-server.js:116
- `console.log("[signal] SIGINT received, shutting down...")` - gateway-server.js:123
- `console.log("[signal] SIGTERM received, shutting down...")` - gateway-server.js:128
- `console.log('[SDK/Eidolon] AI Config:', EIDOLON_CONFIG)` - index.js:64
- `console.error('[memory] Context enrichment failed:', err.message)` - index.js:123
- `console.error('[diagnostics/memory] Error:', err)` - index.js:177
- `console.error('[diagnostics/prefs] Error:', err)` - index.js:192
- `console.error('[diagnostics/session] Error:', err)` - index.js:214
- `console.error('[diagnostics/conversations] Error:', err)` - index.js:224
- _... and 50 more_

---

## 10. Gateway

### Files

- [server/gateway/assistant-proxy.ts](./server/gateway/assistant-proxy.ts) (active)

### 3. Console log

- `console.log(`[gateway] assistant override on :${port}`)` - server/gateway/assistant-proxy.ts:124

---

## 11. Scripts & Utils

### Files

- [server/scripts/continuous-monitor.js](./server/scripts/continuous-monitor.js) (active)
- [server/scripts/db-doctor.js](./server/scripts/db-doctor.js) (active)
- [server/scripts/run-sql-migration.js](./server/scripts/run-sql-migration.js) (active)
- [server/scripts/seed-dfw-venues.js](./server/scripts/seed-dfw-venues.js) (active)
- [server/scripts/seed-markets.js](./server/scripts/seed-markets.js) (active) → Seeds 102 global markets with timezones
- [server/scripts/seed-countries.js](./server/scripts/seed-countries.js) (active) → Seeds countries table
- [server/scripts/self-healing-monitor.js](./server/scripts/self-healing-monitor.js) (active)
- [server/scripts/workspace-startup.sh](./server/scripts/workspace-startup.sh) (active)
- [scripts/capture-workflow-logs.js](./scripts/capture-workflow-logs.js) (not active)
- [scripts/check-no-hardcoded-location.mjs](./scripts/check-no-hardcoded-location.mjs) (not active) → UI: [location.ts](./client/src/types/location.ts)
- [scripts/complete-workflow-capture.sh](./scripts/complete-workflow-capture.sh) (not active)
- [scripts/create-all-tables.sql](./scripts/create-all-tables.sql) (not active) → UI: [table.tsx](./client/src/components/ui/table.tsx)
- [scripts/enhanced-db-logger.js](./scripts/enhanced-db-logger.js) (not active)
- [scripts/find-json-errors.mjs](./scripts/find-json-errors.mjs) (not active)
- [scripts/fix-progress.js](./scripts/fix-progress.js) (not active) → UI: [progress.tsx](./client/src/components/ui/progress.tsx)
- [scripts/full-workflow-analysis.mjs](./scripts/full-workflow-analysis.mjs) (not active)
- [scripts/make-jwks.mjs](./scripts/make-jwks.mjs) (not active)
- [scripts/port-probe.mjs](./scripts/port-probe.mjs) (not active)
- [scripts/postdeploy-sql.mjs](./scripts/postdeploy-sql.mjs) (not active)
- [scripts/README.md](./scripts/README.md) (not active)
- [scripts/refresh-enrichment.mjs](./scripts/refresh-enrichment.mjs) (not active)
- [scripts/seed-event.mjs](./scripts/seed-event.mjs) (not active)
- [scripts/sign-token.mjs](./scripts/sign-token.mjs) (not active)
- [scripts/simple-capture.sh](./scripts/simple-capture.sh) (not active)
- [scripts/smoke-coach-context.mjs](./scripts/smoke-coach-context.mjs) (not active)
- [scripts/smoke-strategy.mjs](./scripts/smoke-strategy.mjs) (not active)
- [scripts/start-replit.js](./scripts/start-replit.js) (not active)
- [scripts/trace-workflow-detailed.sh](./scripts/trace-workflow-detailed.sh) (not active)
- [scripts/typescript-error-counter.js](./scripts/typescript-error-counter.js) (not active)
- [scripts/validate-all.sh](./scripts/validate-all.sh) (not active)
- [scripts/which-assistant.mjs](./scripts/which-assistant.mjs) (not active)

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

- 1.1.1 place_id
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

- `.map(` - scripts/capture-workflow-logs.js:64
- `.map(` - scripts/capture-workflow-logs.js:99
- `.map(` - scripts/capture-workflow-logs.js:105
- `.map(` - scripts/fix-progress.js:27
- `.map(` - scripts/fix-progress.js:28
- `.reduce(` - scripts/fix-progress.js:104
- `.map(` - scripts/port-probe.mjs:2
- `.map(` - scripts/port-probe.mjs:9
- `.map(` - scripts/postdeploy-sql.mjs:51
- `.filter(` - scripts/smoke-coach-context.mjs:43
- `.filter(` - scripts/smoke-strategy.mjs:64
- `.map(` - scripts/typescript-error-counter.js:168
- `.map(` - server/scripts/db-doctor.js:16
- `.map(` - server/scripts/db-doctor.js:31
- `.filter(` - server/scripts/self-healing-monitor.js:59
- `.filter(` - server/scripts/self-healing-monitor.js:76
- `.filter(` - server/scripts/self-healing-monitor.js:265
- `.map(` - server/scripts/self-healing-monitor.js:58
- `.map(` - server/scripts/self-healing-monitor.js:75
- `.map(` - server/scripts/self-healing-monitor.js:203

#### 2.2 Resolved in db

- `db.select(` - scripts/enhanced-db-logger.js:62
- `db.insert(` - scripts/enhanced-db-logger.js:69
- `await client.query(` - scripts/full-workflow-analysis.mjs:241
- `await client.query(` - scripts/full-workflow-analysis.mjs:272
- `await client.query(` - scripts/full-workflow-analysis.mjs:302
- `await client.query(` - scripts/full-workflow-analysis.mjs:320
- `await db.execute(` - scripts/postdeploy-sql.mjs:34
- `await db.execute(` - scripts/postdeploy-sql.mjs:46
- `await db.execute(` - scripts/postdeploy-sql.mjs:71
- `await db.execute(` - scripts/postdeploy-sql.mjs:100
- `await db.execute(` - scripts/refresh-enrichment.mjs:24
- `await db.execute(` - scripts/refresh-enrichment.mjs:33
- `await db.execute(` - scripts/seed-event.mjs:52
- `await pool.query(` - server/scripts/db-doctor.js:7
- `await pool.query(` - server/scripts/db-doctor.js:10
- `await pool.query(` - server/scripts/db-doctor.js:13
- `await pool.query(` - server/scripts/db-doctor.js:18
- `await pool.query(` - server/scripts/db-doctor.js:27
- `await pool.query(` - server/scripts/run-sql-migration.js:15
- `await db.select(` - server/scripts/seed-dfw-venues.js:241
- `await db.insert(` - server/scripts/seed-dfw-venues.js:252
- `await db.insert(` - server/scripts/seed-dfw-venues.js:256
- `await db.execute(` - server/scripts/self-healing-monitor.js:51
- `await db.execute(` - server/scripts/self-healing-monitor.js:68
- `await db.execute(` - server/scripts/self-healing-monitor.js:192
- `await db.delete(` - server/scripts/self-healing-monitor.js:208
- `await db.execute(` - server/scripts/self-healing-monitor.js:216

### 3. Console log

- `console.log(logLine.trim()` - scripts/capture-workflow-logs.js:41
- `console.warn(`Warning: Could not read ${file}: ${err.message}`)` - scripts/check-no-hardcoded-location.mjs:55
- `console.error('\n❌ HARDCODED LOCATION DATA DETECTED:\n')` - scripts/check-no-hardcoded-location.mjs:61
- `console.error(`  ${v.file}:${v.line}`)` - scripts/check-no-hardcoded-location.mjs:63
- `console.error(`    Pattern: ${v.pattern}`)` - scripts/check-no-hardcoded-location.mjs:64
- `console.error(`    Match: ${v.match}`)` - scripts/check-no-hardcoded-location.mjs:65
- `console.error('')` - scripts/check-no-hardcoded-location.mjs:66
- `console.error('💡 Use runtime location providers instead of hard...)` - scripts/check-no-hardcoded-location.mjs:68
- `console.log('✅ No hardcoded location data detected.')` - scripts/check-no-hardcoded-location.mjs:72
- `console.log(`   Scanned ${files.length} files.`)` - scripts/check-no-hardcoded-location.mjs:73
- `console.log(`[DB-OP] ${operation} on ${table}`, logEntry)` - scripts/enhanced-db-logger.js:20
- `console.log("\n" + "=".repeat(70)` - scripts/find-json-errors.mjs:123
- `console.log(BOLD + CYAN + "🔍 JSON ERROR SCANNER" + RESET)` - scripts/find-json-errors.mjs:124
- `console.log("=".repeat(70)` - scripts/find-json-errors.mjs:125
- `console.log(YELLOW + "Scanning repository for JSON files..." +...)` - scripts/find-json-errors.mjs:127
- `console.log(`Found ${BOLD}${jsonFiles.length}${RESET} JSON fil...)` - scripts/find-json-errors.mjs:132
- `console.log("\n" + "=".repeat(70)` - scripts/find-json-errors.mjs:149
- `console.log(BOLD + "📊 RESULTS SUMMARY" + RESET)` - scripts/find-json-errors.mjs:150
- `console.log("=".repeat(70)` - scripts/find-json-errors.mjs:151
- `console.log(`Total files scanned:  ${BOLD}${results.total}${RE...)` - scripts/find-json-errors.mjs:153
- `console.log(`Valid JSON files:     ${GREEN}${BOLD}${results.va...)` - scripts/find-json-errors.mjs:154
- `console.log(`Files with errors:    ${results.errors.length > 0...)` - scripts/find-json-errors.mjs:155
- `console.log(`Files with warnings:  ${results.warnings.length >...)` - scripts/find-json-errors.mjs:156
- `console.log()` - scripts/find-json-errors.mjs:157
- `console.log("=".repeat(70)` - scripts/find-json-errors.mjs:161
- `console.log(BOLD + RED + "❌ JSON SYNTAX ERRORS FOUND" + RESET)` - scripts/find-json-errors.mjs:162
- `console.log("=".repeat(70)` - scripts/find-json-errors.mjs:163
- `console.log(`${BOLD}${idx + 1}. ${err.file}${RESET}`)` - scripts/find-json-errors.mjs:166
- `console.log(`   ${RED}Error:${RESET} ${err.error}`)` - scripts/find-json-errors.mjs:167
- `console.log(`   ${YELLOW}Location:${RESET} Line ${err.line}, C...)` - scripts/find-json-errors.mjs:168
- _... and 398 more_

---

## 12. Shared

### Files

- [shared/config.js](./shared/config.js) (active)
- [shared/identity.ts](./shared/identity.ts) (active)
- [shared/ports.js](./shared/ports.js) (active)
- [shared/schema.js](./shared/schema.js) (active)
- [shared/types/action.ts](./shared/types/action.ts) (active)
- [shared/types/ids.ts](./shared/types/ids.ts) (active)
- [shared/types/location.ts](./shared/types/location.ts) (active) → UI: [location-context-clean.tsx](./client/src/contexts/location-context-clean.tsx)
- [shared/types/reco.ts](./shared/types/reco.ts) (active)
- [shared/types/snapshot.ts](./shared/types/snapshot.ts) (active) → UI: [snapshot.ts](./client/src/lib/snapshot.ts)

### 1. Schema

#### 1.1 actions


_Source: shared/schema.js_

#### 1.1 agent_memory


_Source: shared/schema.js_

#### 1.1 app_feedback


_Source: shared/schema.js_

#### 1.1 assistant_memory


_Source: shared/schema.js_

#### 1.1 block_jobs


_Source: shared/schema.js_

#### 1.1 cross_thread_memory


_Source: shared/schema.js_

#### 1.1 eidolon_memory


_Source: shared/schema.js_

#### 1.1 http_idem


_Source: shared/schema.js_

#### 1.1 llm_venue_suggestions


_Source: shared/schema.js_

#### 1.1 places_cache


_Source: shared/schema.js_

#### 1.1 ranking_candidates


_Source: shared/schema.js_

#### 1.1 rankings


_Source: shared/schema.js_

#### 1.1 snapshots


_Source: shared/schema.js_

#### 1.1 strategies


_Source: shared/schema.js_

#### 1.1 strategy_feedback


_Source: shared/schema.js_

#### 1.1 travel_disruptions


_Source: shared/schema.js_

#### 1.1 triad_jobs


_Source: shared/schema.js_

#### 1.1 venue_catalog


_Source: shared/schema.js_

#### 1.1 venue_events

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
- 1.1.1 news_briefing
- 1.1.1 device
- 1.1.1 permissions
- 1.1.1 extras
- 1.1.1 last_strategy_day_part
- 1.1.1 trigger_reason
- 1.1.1 id
- 1.1.1 strategy_id
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
- 1.1.1 state
- 1.1.1 user_address
- 1.1.1 user_id
- 1.1.1 events
- 1.1.1 news
- 1.1.1 traffic
- 1.1.1 valid_window_start
- 1.1.1 valid_window_end
- 1.1.1 strategy_timestamp
- 1.1.1 user_resolved_address
- 1.1.1 user_resolved_city
- 1.1.1 user_resolved_state
- 1.1.1 minstrategy
- 1.1.1 holiday
- 1.1.1 briefing_news
- 1.1.1 briefing_events
- 1.1.1 briefing_traffic
- 1.1.1 briefing
- 1.1.1 consolidated_strategy
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
- 1.1.1 kind
- 1.1.1 status
- 1.1.1 created_at
- 1.1.1 key
- 1.1.1 status
- 1.1.1 body
- 1.1.1 created_at
- 1.1.1 place_id
- 1.1.1 formatted_hours
- 1.1.1 cached_at
- 1.1.1 access_count
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 place_id
- 1.1.1 venue_name
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 id
- 1.1.1 snapshot_id
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
- 1.1.1 session_id
- 1.1.1 entry_type
- 1.1.1 title
- 1.1.1 content
- 1.1.1 status
- 1.1.1 metadata
- 1.1.1 created_at
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
- 1.1.1 venue_id
- 1.1.1 place_id
- 1.1.1 title
- 1.1.1 starts_at
- 1.1.1 ends_at
- 1.1.1 source
- 1.1.1 radius_m
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: shared/schema.js_

#### 1.1 venue_feedback


_Source: shared/schema.js_

#### 1.1 venue_metrics


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

- `console.log('[config] ✅ Environment validation passed')` - shared/config.js:40
- `console.error('[config] ❌ Environment validation failed:')` - shared/config.js:43
- `console.error(`  - ${error.path.join('.')` - shared/config.js:45
- `console.error('\n[config] Please check your .env file and ensure...)` - shared/config.js:47
- `console.error('[config] See .env.example for reference.\n')` - shared/config.js:48

---

## 13. Other Workflow

### Files

- [dist/index.js](./dist/index.js) (active) → UI: [index-BzKHz2OF.js](./client/dist/assets/index-BzKHz2OF.js)
- [dist/index.js.map](./dist/index.js.map) (active) → UI: [index.html](./client/dist/index.html)
- [server/agent/agent-override-llm.js](./server/agent/agent-override-llm.js) (active)
- [server/agent/chat.js](./server/agent/chat.js) (active) → UI: [CoachChat.tsx](./client/src/components/CoachChat.tsx)
- [server/agent/config-manager.js](./server/agent/config-manager.js) (active)
- [server/agent/context-awareness.js](./server/agent/context-awareness.js) (active)
- [server/agent/embed.js](./server/agent/embed.js) (active)
- [server/agent/enhanced-context.js](./server/agent/enhanced-context.js) (active)
- [server/agent/index.ts](./server/agent/index.ts) (active) → UI: [index-BzKHz2OF.js](./client/dist/assets/index-BzKHz2OF.js)
- [server/agent/routes.js](./server/agent/routes.js) (active)
- [server/agent/thread-context.js](./server/agent/thread-context.js) (active)
- [server/assistant-events.ts](./server/assistant-events.ts) (active)
- [server/continuity-manager.ts](./server/continuity-manager.ts) (active)
- [server/diagnostics.sh](./server/diagnostics.sh) (active)
- [server/pathHelper.js](./server/pathHelper.js) (active)
- [server/types/driving-plan.ts](./server/types/driving-plan.ts) (active)
- [server/util/circuit.js](./server/util/circuit.js) (active)
- [server/util/uuid.js](./server/util/uuid.js) (active)
- [server/util/validate-snapshot.js](./server/util/validate-snapshot.js) (active) → UI: [snapshot.ts](./client/src/lib/snapshot.ts)
- [server/utils/eta.js](./server/utils/eta.js) (active) → UI: [getTimeMetadata.ts](./client/src/utils/getTimeMetadata.ts)

### 2. API Call

#### 2.1 Resolved in memory

- `.map(` - server/agent/context-awareness.js:26
- `.map(` - server/agent/context-awareness.js:37
- `.map(` - server/agent/context-awareness.js:47
- `.map(` - server/agent/context-awareness.js:63
- `.map(` - server/agent/context-awareness.js:75
- `.map(` - server/agent/context-awareness.js:87
- `.map(` - server/agent/context-awareness.js:155
- `.map(` - server/agent/enhanced-context.js:57
- `.map(` - server/agent/enhanced-context.js:72
- `.map(` - server/agent/enhanced-context.js:84
- `.map(` - server/agent/enhanced-context.js:103
- `.map(` - server/agent/enhanced-context.js:117
- `.map(` - server/agent/enhanced-context.js:131
- `.map(` - server/agent/enhanced-context.js:144
- `.map(` - server/agent/enhanced-context.js:162
- `.map(` - server/agent/enhanced-context.js:381
- `.map(` - server/agent/enhanced-context.js:399
- `.map(` - server/agent/routes.js:213
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
- `.map(` - server/agent/thread-context.js:427
- _... and 8 more_

#### 2.2 Resolved in db

- `await pool.query(` - server/agent/chat.js:14
- `await pool.query(` - server/agent/chat.js:25
- `await db.select(` - server/agent/context-awareness.js:25
- `await db.select(` - server/agent/context-awareness.js:36
- `await db.select(` - server/agent/context-awareness.js:46
- `await db.execute(` - server/agent/context-awareness.js:175
- `await db.select(` - server/agent/enhanced-context.js:56
- `await db.select(` - server/agent/enhanced-context.js:71
- `await db.select(` - server/agent/enhanced-context.js:83
- `await db.execute(` - server/agent/enhanced-context.js:282
- `await db.execute(` - server/agent/enhanced-context.js:306
- `await db.select(` - server/agent/enhanced-context.js:322
- `await pool.query(` - server/agent/enhanced-context.js:354
- `await pool.query(` - server/agent/enhanced-context.js:391
- `await pool.query(` - server/agent/thread-context.js:126
- `await pool.query(` - server/agent/thread-context.js:386

### 3. Console log

- `console.log("GPT-5 Agent initialized")` - dist/index.js:5
- `console.log("Agent response:", msg)` - dist/index.js:11
- `console.log("Terminal command:", cmd)` - dist/index.js:29
- `console.log("GPT-5 Agent ready - context configured")` - dist/index.js:39
- `console.error("Agent initialization failed:", error)` - dist/index.js:42
- `console.log(`[Atlas/Claude] Using ${CLAUDE_MODEL} with ${CLAUD...)` - server/agent/agent-override-llm.js:39
- `console.log(`[Atlas/GPT-5] Using ${GPT5_MODEL} with reasoning_...)` - server/agent/agent-override-llm.js:73
- `console.log(`[Atlas/GPT-5] Using ${GPT5_MODEL} with max_tokens...)` - server/agent/agent-override-llm.js:76
- `console.log(`[Atlas/Gemini] Using ${GEMINI_MODEL} with temp=${...)` - server/agent/agent-override-llm.js:114
- `console.warn(`[Atlas] Unknown provider in AGENT_OVERRIDE_ORDER:...)` - server/agent/agent-override-llm.js:142
- `console.log(`[Atlas] Attempting ${providerName}...`)` - server/agent/agent-override-llm.js:147
- `console.log(`✅ [Atlas] ${providerName} succeeded in ${result.e...)` - server/agent/agent-override-llm.js:149
- `console.warn(`⚠️ [Atlas] ${providerName} failed:`, errorMsg)` - server/agent/agent-override-llm.js:153
- `console.log(`[Chat] User ${userId.slice(0, 8)` - server/agent/chat.js:141
- `console.log(`[Chat] Response complete for user ${userId.slice(...)` - server/agent/chat.js:163
- `console.error(`[Chat] Error:`, err)` - server/agent/chat.js:165
- `console.log(`[agent embed] Mounting Agent at ${basePath}, WS a...)` - server/agent/embed.js:5
- `console.log(`[agent embed] WS upgrade request for ${url}`)` - server/agent/embed.js:43
- `console.log(`[agent embed] WS client connected from ${req.sock...)` - server/agent/embed.js:51
- `console.error('[agent embed] Ping error:', err.message)` - server/agent/embed.js:59
- `console.log(`[agent embed] Received: ${msg.substring(0, 100)` - server/agent/embed.js:68
- `console.error('[agent embed] Message error:', err.message)` - server/agent/embed.js:77
- `console.log('[agent embed] WS client disconnected')` - server/agent/embed.js:82
- `console.error('[agent embed] WS error:', err.message)` - server/agent/embed.js:87
- `console.log(`[agent embed] WebSocket server ready for ${wsPath...)` - server/agent/embed.js:99
- `console.warn('[Enhanced Context] Failed to load recent snapshot...)` - server/agent/enhanced-context.js:67
- `console.warn('[Enhanced Context] Failed to load recent strategi...)` - server/agent/enhanced-context.js:79
- `console.warn('[Enhanced Context] Failed to load recent actions:...)` - server/agent/enhanced-context.js:91
- `console.warn('[Enhanced Context] Failed to load user preference...)` - server/agent/enhanced-context.js:106
- `console.warn('[Enhanced Context] Failed to load session history...)` - server/agent/enhanced-context.js:120
- _... and 17 more_

---

## 2. Bootstrap & Init

### Files

- [server/bootstrap/enqueue-initial.js](./server/bootstrap/enqueue-initial.js) (active)

### 2. API Call

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

---

## 3. Middleware

### Files

- [server/middleware/auth.ts](./server/middleware/auth.ts) (active) → UI: [useAuth.ts](./client/src/hooks/useAuth.ts)
- [server/middleware/idempotency.js](./server/middleware/idempotency.js) (active)
- [server/middleware/learning-capture.js](./server/middleware/learning-capture.js) (active)
- [server/middleware/logging.js](./server/middleware/logging.js) (active)
- [server/middleware/logging.ts](./server/middleware/logging.ts) (active)
- [server/middleware/metrics.js](./server/middleware/metrics.js) (active)
- [server/middleware/security.js](./server/middleware/security.js) (active)
- [server/middleware/security.ts](./server/middleware/security.ts) (active)
- [server/middleware/timeout.js](./server/middleware/timeout.js) (active)
- [server/middleware/validation.js](./server/middleware/validation.js) (active)

### 2. API Call

#### 2.1 Resolved in memory

- `new Map(` - server/middleware/metrics.js:3
- `.map(` - server/middleware/metrics.js:18
- `.filter(` - server/middleware/security.ts:46
- `.map(` - server/middleware/validation.js:52

#### 2.2 Resolved in db

- `await db.select(` - server/middleware/idempotency.js:12
- `await db.insert(` - server/middleware/idempotency.js:38

### 3. Console log

- `console.warn('[idempotency] Failed to save response:', err.mess...)` - server/middleware/idempotency.js:44
- `console.error('[idempotency] Middleware error:', err)` - server/middleware/idempotency.js:65
- `console.log(`[learning] Captured: ${eventType}`, {       event...)` - server/middleware/learning-capture.js:38
- `console.error('[learning] Failed to capture event:', err.message)` - server/middleware/learning-capture.js:46
- `console.error('[learning] Middleware capture failed:', err.messa...)` - server/middleware/learning-capture.js:73
- `console.log(`[${timestamp}] ${method} ${url} - ${ip}`)` - server/middleware/logging.js:8
- `console.log(`[INFO] ${message}`, data || '')` - server/middleware/logging.ts:5
- `console.error(`[ERROR] ${message}`, data || '')` - server/middleware/logging.ts:6
- `console.error(`[timeout] Request timeout after ${timeout}ms: ${r...)` - server/middleware/timeout.js:23
- `console.error(`[timeout] Response timeout after ${timeout}ms: ${...)` - server/middleware/timeout.js:37

---

## 4. Routes & API

### Files

- [server/routes/actions.js](./server/routes/actions.js) (active)
- [server/routes/blocks-discovery.js](./server/routes/blocks-discovery.js) (active)
- [server/routes/blocks-fast.js](./server/routes/blocks-fast.js) (active)
- [server/routes/blocks-idempotent.js](./server/routes/blocks-idempotent.js) (active)
- [server/routes/blocks-processor.js](./server/routes/blocks-processor.js) (active)
- [server/routes/blocks-triad-strict.js](./server/routes/blocks-triad-strict.js) (active)
- [server/routes/blocks.js](./server/routes/blocks.js) (active) → UI: [SmartBlocks.tsx](./client/src/components/strategy/SmartBlocks.tsx)
- [server/routes/chat-context.js](./server/routes/chat-context.js) (active)
- [server/routes/chat.js](./server/routes/chat.js) (active) → UI: [CoachChat.tsx](./client/src/components/CoachChat.tsx)
- [server/routes/closed-venue-reasoning.js](./server/routes/closed-venue-reasoning.js) (active)
- [server/routes/diagnostics-strategy.js](./server/routes/diagnostics-strategy.js) (active)
- [server/routes/diagnostics.js](./server/routes/diagnostics.js) (active)
- [server/routes/feedback.js](./server/routes/feedback.js) (active) → UI: [FeedbackModal.tsx](./client/src/components/FeedbackModal.tsx)
- [server/routes/geocode-proxy.js](./server/routes/geocode-proxy.js) (active)
- [server/routes/health.js](./server/routes/health.js) (active)
- [server/routes/job-metrics.js](./server/routes/job-metrics.js) (active)
- [server/routes/location.js](./server/routes/location.js) (active) → UI: [location-context-clean.tsx](./client/src/contexts/location-context-clean.tsx)
- [server/routes/ml-health.js](./server/routes/ml-health.js) (active)
- [server/routes/research.js](./server/routes/research.js) (active)
- [server/routes/snapshot.js](./server/routes/snapshot.js) (active) → UI: [snapshot.ts](./client/src/lib/snapshot.ts)
- [server/routes/strategy.js](./server/routes/strategy.js) (active) → UI: [StrategyCoach.tsx](./client/src/components/strategy/StrategyCoach.tsx)
- [server/routes/utils/safeElapsedMs.js](./server/routes/utils/safeElapsedMs.js) (active)
- [server/routes/vector-search.js](./server/routes/vector-search.js) (active)
- [server/routes/venue-events.js](./server/routes/venue-events.js) (active)

### 2. API Call

#### 2.1 Resolved in memory

- `new Map(` - server/routes/actions.js:11
- `.filter(` - server/routes/blocks-discovery.js:310
- `.filter(` - server/routes/blocks-discovery.js:311
- `.map(` - server/routes/blocks-discovery.js:200
- `.map(` - server/routes/blocks-discovery.js:242
- `.map(` - server/routes/blocks-discovery.js:313
- `new Map(` - server/routes/blocks-fast.js:396
- `.filter(` - server/routes/blocks-fast.js:103
- `.filter(` - server/routes/blocks-fast.js:104
- `.filter(` - server/routes/blocks-fast.js:386
- `.filter(` - server/routes/blocks-fast.js:599
- `.filter(` - server/routes/blocks-fast.js:637
- `.map(` - server/routes/blocks-fast.js:638
- `.filter(` - server/routes/blocks-fast.js:654
- `.filter(` - server/routes/blocks-fast.js:655
- `.filter(` - server/routes/blocks-fast.js:656
- `.filter(` - server/routes/blocks-fast.js:809
- `.map(` - server/routes/blocks-fast.js:84
- `.map(` - server/routes/blocks-fast.js:217
- `.map(` - server/routes/blocks-fast.js:302
- `.map(` - server/routes/blocks-fast.js:335
- `.map(` - server/routes/blocks-fast.js:471
- `.map(` - server/routes/blocks-fast.js:580
- `.map(` - server/routes/blocks-fast.js:810
- `.filter(` - server/routes/blocks-triad-strict.js:212
- `.filter(` - server/routes/blocks-triad-strict.js:214
- `.map(` - server/routes/blocks-triad-strict.js:93
- `.map(` - server/routes/blocks-triad-strict.js:118
- `.map(` - server/routes/blocks-triad-strict.js:136
- `.map(` - server/routes/blocks-triad-strict.js:158
- _... and 31 more_

#### 2.2 Resolved in db

- `await db.insert(` - server/routes/actions.js:112
- `await db.execute(` - server/routes/actions.js:118
- `await db.insert(` - server/routes/actions.js:170
- `await db.select(` - server/routes/blocks-discovery.js:86
- `await db.select(` - server/routes/blocks-discovery.js:103
- `await db.select(` - server/routes/blocks-discovery.js:179
- `await db.select(` - server/routes/blocks-fast.js:52
- `await db.select(` - server/routes/blocks-fast.js:66
- `await db.select(` - server/routes/blocks-fast.js:73
- `await db.insert(` - server/routes/blocks-fast.js:149
- `await db.select(` - server/routes/blocks-fast.js:164
- `await db.select(` - server/routes/blocks-fast.js:201
- `await db.select(` - server/routes/blocks-fast.js:244
- `await db.select(` - server/routes/blocks-fast.js:402
- `await db.select(` - server/routes/blocks-fast.js:716
- `await db.select(` - server/routes/blocks-fast.js:782
- `await db.select(` - server/routes/blocks-fast.js:794
- `await db.select(` - server/routes/blocks-fast.js:799
- `await db.select(` - server/routes/blocks.js:150
- `await db.select(` - server/routes/blocks.js:177
- `await db.select(` - server/routes/blocks.js:182
- `await db.execute(` - server/routes/blocks.js:703
- `await db.insert(` - server/routes/blocks.js:735
- `await db.select(` - server/routes/diagnostics-strategy.js:20
- `await db.select(` - server/routes/diagnostics-strategy.js:28
- `await db.select(` - server/routes/diagnostics-strategy.js:49
- `await db.select(` - server/routes/diagnostics-strategy.js:57
- `await db.select(` - server/routes/diagnostics-strategy.js:77
- `await db.execute(` - server/routes/diagnostics.js:19
- `await db.execute(` - server/routes/diagnostics.js:40
- _... and 41 more_

### 3. Console log

- `console.log(`⚡ Idempotent request detected - returning cached ...)` - server/routes/actions.js:45
- `console.log(`📸 Action anchored to ranking's snapshot: ${snaps...)` - server/routes/actions.js:69
- `console.warn('[actions] No snapshot found, action not logged')` - server/routes/actions.js:85
- `console.log(`📊 Action logged: ${action}${block_id ? ` on ${bl...)` - server/routes/actions.js:113
- `console.log(`📈 Bumped times_chosen for ${block_id}`)` - server/routes/actions.js:126
- `console.warn(`⚠️ Metrics bump skipped for ${block_id}:`, metric...)` - server/routes/actions.js:129
- `console.warn(`⚠️ Foreign key error on ${constraint} (replicatio...)` - server/routes/actions.js:159
- `console.warn(`⚠️ Replication lag persists after ${maxRetries} r...)` - server/routes/actions.js:167
- `console.log(`📊 Action logged (no ranking)` - server/routes/actions.js:171
- `console.error(`❌ Snapshot ${snapshot_id} not found after ${maxRe...)` - server/routes/actions.js:193
- `console.error('❌ Action logging error:', error)` - server/routes/actions.js:206
- `console.log(`🔄 DISCOVERY: lat=${latitude} lng=${longitude}`)` - server/routes/blocks-discovery.js:73
- `console.log(`📸 Current snapshot: ${city}, ${state} (${dayPart...)` - server/routes/blocks-discovery.js:98
- `console.log(`🎯 Trigger: ${trigger.reason} - ${triggerMessage}...)` - server/routes/blocks-discovery.js:122
- `console.log(`✋ No update needed - using cached strategy`)` - server/routes/blocks-discovery.js:125
- `console.log(`✈️ Driver near ${nearbyAirport.code} (${nearbyAir...)` - server/routes/blocks-discovery.js:141
- `console.log(`📊 Airport context:`, airportContext)` - server/routes/blocks-discovery.js:172
- `console.log(`✅ Found ${allVenues.length} total venues in catal...)` - server/routes/blocks-discovery.js:196
- `console.log(`🌈 Selected ${diverseVenues.length} diverse venue...)` - server/routes/blocks-discovery.js:214
- `console.log(`🔍 Exploration mode: Asking LLM for NEW venue sug...)` - server/routes/blocks-discovery.js:234
- `console.log(`💡 LLM suggested ${suggestions.length} new venues...)` - server/routes/blocks-discovery.js:276
- `console.log(`✅ Discovery results:`, discoveryResults)` - server/routes/blocks-discovery.js:286
- `console.error(`❌ Discovery failed:`, error.message)` - server/routes/blocks-discovery.js:289
- `console.log(`📊 Exploitation mode: Using proven venues only`)` - server/routes/blocks-discovery.js:293
- `console.error('[blocks-discovery] Error:', error)` - server/routes/blocks-discovery.js:332
- `console.error('[blocks-fast GET] Error:', error)` - server/routes/blocks-fast.js:113
- `console.log(`[audit:${correlationId}] ${step}:`, JSON.stringif...)` - server/routes/blocks-fast.js:127
- `console.log(`[blocks-fast POST] ✅ Triad job queued for ${snaps...)` - server/routes/blocks-fast.js:154
- `console.warn(`[blocks-fast POST] Job insertion skipped (may alr...)` - server/routes/blocks-fast.js:156
- `console.log(`⚡ [${correlationId}] FAST BLOCKS: lat=${lat} lng=...)` - server/routes/blocks-fast.js:193
- _... and 214 more_

---

## 5. Core Logic

### Files

- [server/lib/ability-routes.js](./server/lib/ability-routes.js) (active)
- [server/lib/adapters/anthropic-adapter.js](./server/lib/adapters/anthropic-adapter.js) (active)
- [server/lib/adapters/anthropic-claude.js](./server/lib/adapters/anthropic-claude.js) (active)
- [server/lib/adapters/anthropic-sonnet45.js](./server/lib/adapters/anthropic-sonnet45.js) (active)
- [server/lib/adapters/gemini-2.5-pro.js](./server/lib/adapters/gemini-2.5-pro.js) (active)
- [server/lib/adapters/gemini-adapter.js](./server/lib/adapters/gemini-adapter.js) (active)
- [server/lib/adapters/google-gemini.js](./server/lib/adapters/google-gemini.js) (active)
- [server/lib/adapters/index.js](./server/lib/adapters/index.js) (active) → UI: [index-BzKHz2OF.js](./client/dist/assets/index-BzKHz2OF.js)
- [server/lib/adapters/openai-adapter.js](./server/lib/adapters/openai-adapter.js) (active)
- [server/lib/adapters/openai-gpt5.js](./server/lib/adapters/openai-gpt5.js) (active)
- [server/lib/anthropic-extended.d.ts](./server/lib/anthropic-extended.d.ts) (active)
- [server/lib/anthropic-extended.js](./server/lib/anthropic-extended.js) (active)
- [server/lib/audit-logger.js](./server/lib/audit-logger.js) (active)
- [server/lib/auth.js](./server/lib/auth.js) (active) → UI: [useAuth.ts](./client/src/hooks/useAuth.ts)
- [server/lib/blocks-job-queue.js](./server/lib/blocks-job-queue.js) (active)
- [server/lib/blocks-jobs.js](./server/lib/blocks-jobs.js) (active)
- [server/lib/blocks-queue.js](./server/lib/blocks-queue.js) (active)
- [server/lib/cache-routes.js](./server/lib/cache-routes.js) (active)
- [server/lib/capabilities.js](./server/lib/capabilities.js) (active)
- [server/lib/coach-dal.js](./server/lib/coach-dal.js) (active)
- [server/lib/db-client.js](./server/lib/db-client.js) (active)
- [server/lib/driveTime.js](./server/lib/driveTime.js) (active)
- [server/lib/enhanced-smart-blocks.js](./server/lib/enhanced-smart-blocks.js) (active)
- [server/lib/event-map.js](./server/lib/event-map.js) (active)
- [server/lib/event-proximity-boost.js](./server/lib/event-proximity-boost.js) (active)
- [server/lib/exploration.js](./server/lib/exploration.js) (active)
- [server/lib/explore.js](./server/lib/explore.js) (active)
- [server/lib/faa-asws.js](./server/lib/faa-asws.js) (active)
- [server/lib/fast-tactical-reranker.js](./server/lib/fast-tactical-reranker.js) (active)
- [server/lib/gemini-enricher.js](./server/lib/gemini-enricher.js) (active)
- [server/lib/gemini-news-briefing.js](./server/lib/gemini-news-briefing.js) (active)
- [server/lib/geo.js](./server/lib/geo.js) (active) → UI: [use-enhanced-geolocation.tsx](./client/src/hooks/use-enhanced-geolocation.tsx)
- [server/lib/geocoding.js](./server/lib/geocoding.js) (active)
- [server/lib/gpt5-retry.js](./server/lib/gpt5-retry.js) (active)
- [server/lib/gpt5-tactical-planner.js](./server/lib/gpt5-tactical-planner.js) (active)
- [server/lib/gpt5-venue-generator.js](./server/lib/gpt5-venue-generator.js) (active)
- [server/lib/job-queue.js](./server/lib/job-queue.js) (active)
- [server/lib/jwt.ts](./server/lib/jwt.ts) (active)
- [server/lib/llm-router-v2.js](./server/lib/llm-router-v2.js) (active)
- [server/lib/llm-router.js](./server/lib/llm-router.js) (active)
- [server/lib/locks.js](./server/lib/locks.js) (active) → UI: [SmartBlocks.tsx](./client/src/components/strategy/SmartBlocks.tsx)
- [server/lib/logger.ts](./server/lib/logger.ts) (active)
- [server/lib/models-dictionary.js](./server/lib/models-dictionary.js) (active)
- [server/lib/perplexity-event-prompt.js](./server/lib/perplexity-event-prompt.js) (active)
- [server/lib/perplexity-research.js](./server/lib/perplexity-research.js) (active)
- [server/lib/persist-ranking.js](./server/lib/persist-ranking.js) (active)
- [server/lib/places-cache.js](./server/lib/places-cache.js) (active)
- [server/lib/places-hours.js](./server/lib/places-hours.js) (active)
- [server/lib/planner-gpt5.js](./server/lib/planner-gpt5.js) (active)
- [server/lib/priors.js](./server/lib/priors.js) (active)
- [server/lib/prompt-templates.js](./server/lib/prompt-templates.js) (active)
- [server/lib/providers/briefing.js](./server/lib/providers/briefing.js) (active) → UI: [BriefingPage.tsx](./client/src/pages/BriefingPage.tsx)
- [server/lib/providers/consolidator.js](./server/lib/providers/consolidator.js) (active)
- [server/lib/providers/holiday-checker.js](./server/lib/providers/holiday-checker.js) (active)
- [server/lib/providers/minstrategy.js](./server/lib/providers/minstrategy.js) (active)
- [server/lib/rangePolicy.js](./server/lib/rangePolicy.js) (active)
- [server/lib/receipt.js](./server/lib/receipt.js) (active)
- [server/lib/routes-api.js](./server/lib/routes-api.js) (active)
- [server/lib/runtime-fresh-planner-prompt.js](./server/lib/runtime-fresh-planner-prompt.js) (active)
- [server/lib/schema-registry.js](./server/lib/schema-registry.js) (active)
- [server/lib/scoring-engine.js](./server/lib/scoring-engine.js) (active)
- [server/lib/semantic-search.js](./server/lib/semantic-search.js) (active)
- [server/lib/snapshot/get-snapshot-context.js](./server/lib/snapshot/get-snapshot-context.js) (active) → UI: [snapshot.ts](./client/src/lib/snapshot.ts)
- [server/lib/strategies/assert-safe.js](./server/lib/strategies/assert-safe.js) (active)
- [server/lib/strategies/index.js](./server/lib/strategies/index.js) (active) → UI: [index-BzKHz2OF.js](./client/dist/assets/index-BzKHz2OF.js)
- [server/lib/strategy-consolidator.js](./server/lib/strategy-consolidator.js) (active)
- [server/lib/strategy-generator-parallel.js](./server/lib/strategy-generator-parallel.js) (active)
- [server/lib/strategy-generator.js](./server/lib/strategy-generator.js) (active)
- [server/lib/strategy-triggers.js](./server/lib/strategy-triggers.js) (active)
- [server/lib/strategy-utils.js](./server/lib/strategy-utils.js) (active) → UI: [utils.ts](./client/src/lib/utils.ts)
- [server/lib/strategyPrompt.js](./server/lib/strategyPrompt.js) (active)
- [server/lib/subagents/event-verifier.js](./server/lib/subagents/event-verifier.js) (active)
- [server/lib/transient-retry.js](./server/lib/transient-retry.js) (active)
- [server/lib/triad-orchestrator.js](./server/lib/triad-orchestrator.js) (active)
- [server/lib/validate-strategy-env.js](./server/lib/validate-strategy-env.js) (active)
- [server/lib/validation-gates.js](./server/lib/validation-gates.js) (active)
- [server/lib/validation.ts](./server/lib/validation.ts) (active)
- [server/lib/validator-gemini.js](./server/lib/validator-gemini.js) (active)
- [server/lib/venue-discovery.js](./server/lib/venue-discovery.js) (active)
- [server/lib/venue-enrichment.js](./server/lib/venue-enrichment.js) (active)
- [server/lib/venue-event-research.js](./server/lib/venue-event-research.js) (active)

### 2. API Call

#### 2.1 Resolved in memory

- `.map(` - server/lib/adapters/anthropic-claude.js:53
- `.map(` - server/lib/adapters/anthropic-sonnet45.js:34
- `.map(` - server/lib/adapters/gemini-2.5-pro.js:34
- `.map(` - server/lib/adapters/google-gemini.js:24
- `.map(` - server/lib/adapters/openai-gpt5.js:141
- `.filter(` - server/lib/audit-logger.js:63
- `new Map(` - server/lib/blocks-job-queue.js:7
- `new Map(` - server/lib/cache-routes.js:5
- `.map(` - server/lib/capabilities.js:12
- `.map(` - server/lib/coach-dal.js:207
- `.map(` - server/lib/enhanced-smart-blocks.js:79
- `.map(` - server/lib/enhanced-smart-blocks.js:130
- `new Map(` - server/lib/event-map.js:28
- `new Map(` - server/lib/event-map.js:29
- `Map()` - server/lib/event-map.js:57
- `new Map(` - server/lib/event-map.js:61
- `.filter(` - server/lib/event-map.js:66
- `.filter(` - server/lib/event-proximity-boost.js:108
- `.filter(` - server/lib/event-proximity-boost.js:134
- `.map(` - server/lib/explore.js:4
- `new Map(` - server/lib/faa-asws.js:199
- `.map(` - server/lib/faa-asws.js:113
- `.filter(` - server/lib/faa-asws.js:314
- `.map(` - server/lib/faa-asws.js:103
- `.map(` - server/lib/faa-asws.js:238
- `.map(` - server/lib/faa-asws.js:308
- `.filter(` - server/lib/fast-tactical-reranker.js:107
- `.map(` - server/lib/fast-tactical-reranker.js:51
- `.map(` - server/lib/fast-tactical-reranker.js:106
- `.map(` - server/lib/fast-tactical-reranker.js:117
- _... and 95 more_

#### 2.2 Resolved in db

- `await db.execute(` - server/lib/ability-routes.js:106
- `await pool.query(` - server/lib/blocks-jobs.js:14
- `await pool.query(` - server/lib/blocks-jobs.js:22
- `await pool.query(` - server/lib/blocks-jobs.js:30
- `await pool.query(` - server/lib/blocks-jobs.js:39
- `await pool.query(` - server/lib/blocks-jobs.js:47
- `await db.insert(` - server/lib/enhanced-smart-blocks.js:60
- `await db.insert(` - server/lib/enhanced-smart-blocks.js:126
- `await db.update(` - server/lib/enhanced-smart-blocks.js:138
- `await db.execute(` - server/lib/locks.js:11
- `await db.execute(` - server/lib/locks.js:49
- `await db.execute(` - server/lib/locks.js:66
- `await db.execute(` - server/lib/locks.js:76
- `await db.execute(` - server/lib/locks.js:93
- `await client.query(` - server/lib/persist-ranking.js:17
- `await client.query(` - server/lib/persist-ranking.js:21
- `await client.query(` - server/lib/persist-ranking.js:50
- `await client.query(` - server/lib/persist-ranking.js:66
- `await client.query(` - server/lib/persist-ranking.js:122
- `await client.query(` - server/lib/persist-ranking.js:128
- `await client.query(` - server/lib/persist-ranking.js:132
- `await pool.query(` - server/lib/places-cache.js:28
- `await db.execute(` - server/lib/places-hours.js:67
- `await db.update(` - server/lib/providers/briefing.js:139
- `await db.select(` - server/lib/providers/consolidator.js:29
- `await db.update(` - server/lib/providers/consolidator.js:48
- `await db.update(` - server/lib/providers/consolidator.js:58
- `await db.update(` - server/lib/providers/consolidator.js:169
- `await db.update(` - server/lib/providers/consolidator.js:199
- `await db.update(` - server/lib/providers/holiday-checker.js:99
- _... and 42 more_

### 3. Console log

- `console.log(`[model/anthropic] calling ${model} with max_token...)` - server/lib/adapters/anthropic-adapter.js:9
- `console.log("[model/anthropic] resp:", {       model,       co...)` - server/lib/adapters/anthropic-adapter.js:21
- `console.error("[model/anthropic] error:", err?.message || err)` - server/lib/adapters/anthropic-adapter.js:31
- `console.error(`❌ Model mismatch: requested ${model}, got ${j.mod...)` - server/lib/adapters/anthropic-claude.js:49
- `console.log(`[model/gemini] calling ${model} with max_tokens=$...)` - server/lib/adapters/gemini-adapter.js:9
- `console.log(`[model/gemini] 🧹 Removed markdown code block (${...)` - server/lib/adapters/gemini-adapter.js:42
- `console.log(`[model/gemini] 🧹 Extracted JSON (${rawLength} → ...)` - server/lib/adapters/gemini-adapter.js:58
- `console.log(`[model/gemini] ⚠️ JSON extraction failed, keeping...)` - server/lib/adapters/gemini-adapter.js:61
- `console.log("[model/gemini] resp:", {       model,       respo...)` - server/lib/adapters/gemini-adapter.js:68
- `console.error("[model/gemini] error:", err?.message || err)` - server/lib/adapters/gemini-adapter.js:78
- `console.log(`[model-dispatch] role=${role} model=${model}`)` - server/lib/adapters/index.js:22
- `console.log(`[model/openai] calling ${model} with max_tokens=$...)` - server/lib/adapters/openai-adapter.js:33
- `console.log("[model/openai] resp:", {       model,       choic...)` - server/lib/adapters/openai-adapter.js:39
- `console.error("[model/openai] error:", err?.message || err)` - server/lib/adapters/openai-adapter.js:49
- `console.log(`[GPT-5] Calling ${model} with ${samplingStrategy}...)` - server/lib/adapters/openai-gpt5.js:64
- `console.info("[openai]", { snapshot: j.model, usage: j.usage })` - server/lib/adapters/openai-gpt5.js:104
- `console.log(`[GPT-5] Model: ${j.model} | Tokens: ${tokenMetada...)` - server/lib/adapters/openai-gpt5.js:117
- `console.error('❌ No content in GPT-5 response:', JSON.stringify(...)` - server/lib/adapters/openai-gpt5.js:155
- `console.log(`[blocks-queue] Job ${jobId} queued (${queue.lengt...)` - server/lib/blocks-job-queue.js:29
- `console.log(`[blocks-queue] Processing job ${jobId}...`)` - server/lib/blocks-job-queue.js:61
- `console.log(`[blocks-queue] ✅ Job ${jobId} completed in ${job....)` - server/lib/blocks-job-queue.js:76
- `console.error(`[blocks-queue] ❌ Job ${jobId} failed:`, error.mes...)` - server/lib/blocks-job-queue.js:84
- `console.error('[CoachDAL] getHeaderSnapshot error:', error)` - server/lib/coach-dal.js:74
- `console.error('[CoachDAL] getLatestStrategy error:', error)` - server/lib/coach-dal.js:125
- `console.error('[CoachDAL] getBriefing error:', error)` - server/lib/coach-dal.js:156
- `console.error('[CoachDAL] getSmartBlocks error:', error)` - server/lib/coach-dal.js:226
- `console.error('[CoachDAL] getCompleteContext error:', error)` - server/lib/coach-dal.js:254
- `console.log('[db-client] LISTEN client connected')` - server/lib/db-client.js:17
- `console.error('[db-client] Unexpected pg client error:', err)` - server/lib/db-client.js:20
- `console.warn('[db-client] pg client connection ended')` - server/lib/db-client.js:25
- _... and 366 more_

---

## 7. Database

### Files

- [server/db/001_init.sql](./server/db/001_init.sql) (active)
- [server/db/002_seed_dfw.sql](./server/db/002_seed_dfw.sql) (active)
- [server/db/client.js](./server/db/client.js) (active) → UI: [queryClient.ts](./client/src/lib/queryClient.ts)
- [server/db/drizzle-lazy.js](./server/db/drizzle-lazy.js) (active)
- [server/db/drizzle.js](./server/db/drizzle.js) (active)
- [server/db/pool-lazy.js](./server/db/pool-lazy.js) (active)
- [server/db/pool.js](./server/db/pool.js) (active)
- [server/db/rls-middleware.js](./server/db/rls-middleware.js) (active)
- [server/db/sql/2025-10-31_strategy_generic.sql](./server/db/sql/2025-10-31_strategy_generic.sql) (active)
- [drizzle/0000_overjoyed_human_torch.sql](./drizzle/0000_overjoyed_human_torch.sql) (not active)
- [drizzle/0001_crazy_warstar.sql](./drizzle/0001_crazy_warstar.sql) (not active)
- [drizzle/0002_natural_thunderbolts.sql](./drizzle/0002_natural_thunderbolts.sql) (not active)
- [drizzle/0003_charming_grandmaster.sql](./drizzle/0003_charming_grandmaster.sql) (not active)
- [drizzle/0003_event_enrichment.sql](./drizzle/0003_event_enrichment.sql) (not active)
- [drizzle/0004_event_proximity.sql](./drizzle/0004_event_proximity.sql) (not active)
- [drizzle/0004_fluffy_sunfire.sql](./drizzle/0004_fluffy_sunfire.sql) (not active)
- [drizzle/0005_overjoyed_quicksilver.sql](./drizzle/0005_overjoyed_quicksilver.sql) (not active)
- [drizzle/0005_staging_nodes.sql](./drizzle/0005_staging_nodes.sql) (not active)
- [drizzle/0006_steep_the_hood.sql](./drizzle/0006_steep_the_hood.sql) (not active)
- [drizzle/0006_unblock_enrichment_and_staging.sql](./drizzle/0006_unblock_enrichment_and_staging.sql) (not active)
- [drizzle/0007_hot_katie_power.sql](./drizzle/0007_hot_katie_power.sql) (not active)
- [drizzle/0008_event_ttl_automation.sql](./drizzle/0008_event_ttl_automation.sql) (not active)
- [migrations/001_init.sql](./migrations/001_init.sql) (not active)
- [migrations/002_memory_tables.sql](./migrations/002_memory_tables.sql) (not active) → UI: [table.tsx](./client/src/components/ui/table.tsx)
- [migrations/003_rls_security.sql](./migrations/003_rls_security.sql) (not active)
- [migrations/004_jwt_helpers.sql](./migrations/004_jwt_helpers.sql) (not active)
- [migrations/manual/20251006_add_perf_indexes.sql](./migrations/manual/20251006_add_perf_indexes.sql) (not active) → UI: [index.html](./client/dist/index.html)
- [migrations/manual/20251007_add_fk_cascade.sql](./migrations/manual/20251007_add_fk_cascade.sql) (not active)
- [migrations/manual/20251007_fk_cascade_fix.sql](./migrations/manual/20251007_fk_cascade_fix.sql) (not active)

### 1. Schema

#### 1.1 actions

- 1.1.1 action_id
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 ranking_id
- 1.1.1 snapshot_id
- 1.1.1 user_id
- 1.1.1 action
- 1.1.1 block_id
- 1.1.1 dwell_ms
- 1.1.1 from_rank
- 1.1.1 raw

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 agent_memory

- 1.1.1 id
- 1.1.1 session_id
- 1.1.1 entry_type
- 1.1.1 title
- 1.1.1 content
- 1.1.1 status
- 1.1.1 metadata
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 expires_at

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 app_feedback

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 with

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 assistant_memory

- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 WITH

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 block_jobs

- 1.1.1 id
- 1.1.1 status
- 1.1.1 request_body
- 1.1.1 result
- 1.1.1 error
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 updated_at

_Source: drizzle/0003_charming_grandmaster.sql_

#### 1.1 blocks_catalog

- 1.1.1 id
- 1.1.1 region
- 1.1.1 slug
- 1.1.1 name
- 1.1.1 address
- 1.1.1 meta

_Source: server/db/001_init.sql_

#### 1.1 cross_thread_memory

- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 WITH

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 documents

- 1.1.1 id
- 1.1.1 content
- 1.1.1 metadata
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: migrations/001_init.sql_

#### 1.1 eidolon_memory

- 1.1.1 id
- 1.1.1 scope
- 1.1.1 key
- 1.1.1 user_id
- 1.1.1 content
- 1.1.1 created_at
- 1.1.1 with
- 1.1.1 updated_at
- 1.1.1 expires_at
- 1.1.1 WITH

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 events_facts

- 1.1.1 event_id
- 1.1.1 source
- 1.1.1 source_url
- 1.1.1 venue_place_id
- 1.1.1 venue_name
- 1.1.1 event_title
- 1.1.1 event_type
- 1.1.1 start_time
- 1.1.1 end_time
- 1.1.1 coordinates
- 1.1.1 description
- 1.1.1 tags
- 1.1.1 expires_at
- 1.1.1 coordinates_source
- 1.1.1 location_quality
- 1.1.1 radius_hint_m
- 1.1.1 impact_hint
- 1.1.1 created_at
- 1.1.1 updated_at

_Source: drizzle/0003_event_enrichment.sql_

#### 1.1 http_idem

- 1.1.1 key
- 1.1.1 status
- 1.1.1 body
- 1.1.1 created_at
- 1.1.1 with

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 llm_venue_suggestions

- 1.1.1 suggestion_id
- 1.1.1 suggested_at
- 1.1.1 with
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

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 places_cache

- 1.1.1 place_id
- 1.1.1 formatted_hours
- 1.1.1 cached_at
- 1.1.1 with
- 1.1.1 access_count

_Source: drizzle/0000_overjoyed_human_torch.sql_

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

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 rankings

- 1.1.1 ranking_id
- 1.1.1 created_at
- 1.1.1 with
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

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 snapshots

- 1.1.1 snapshot_id
- 1.1.1 created_at
- 1.1.1 with
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

_Source: drizzle/0000_overjoyed_human_torch.sql_

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
- 1.1.1 with
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 model_name
- 1.1.1 model_params
- 1.1.1 prompt_version
- 1.1.1 strategy_for_now
- 1.1.1 city

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 strategy_feedback

- 1.1.1 id
- 1.1.1 user_id
- 1.1.1 snapshot_id
- 1.1.1 ranking_id
- 1.1.1 sentiment
- 1.1.1 comment
- 1.1.1 created_at
- 1.1.1 with

_Source: drizzle/0000_overjoyed_human_torch.sql_

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
- 1.1.1 with
- 1.1.1 next_update_at

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 triad_jobs

- 1.1.1 id
- 1.1.1 snapshot_id
- 1.1.1 kind
- 1.1.1 status
- 1.1.1 created_at
- 1.1.1 with

_Source: drizzle/0000_overjoyed_human_torch.sql_

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
- 1.1.1 with
- 1.1.1 suggestion_metadata
- 1.1.1 created_at
- 1.1.1 last_known_status
- 1.1.1 status_checked_at
- 1.1.1 consecutive_closed_checks
- 1.1.1 auto_suppressed
- 1.1.1 suppression_reason

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 venue_events

- 1.1.1 id
- 1.1.1 venue_id
- 1.1.1 place_id
- 1.1.1 title
- 1.1.1 starts_at
- 1.1.1 with
- 1.1.1 ends_at
- 1.1.1 source
- 1.1.1 radius_m
- 1.1.1 created_at
- 1.1.1 updated_at
- 1.1.1 snapshot_id
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
- 1.1.1 news_briefing
- 1.1.1 device
- 1.1.1 permissions
- 1.1.1 extras
- 1.1.1 last_strategy_day_part
- 1.1.1 trigger_reason
- 1.1.1 strategy_id
- 1.1.1 correlation_id
- 1.1.1 strategy
- 1.1.1 status
- 1.1.1 error_code
- 1.1.1 error_message
- 1.1.1 attempt
- 1.1.1 latency_ms
- 1.1.1 tokens
- 1.1.1 next_retry_at
- 1.1.1 model_name
- 1.1.1 model_params
- 1.1.1 prompt_version
- 1.1.1 strategy_for_now
- 1.1.1 user_address
- 1.1.1 events
- 1.1.1 news
- 1.1.1 traffic
- 1.1.1 valid_window_start
- 1.1.1 valid_window_end
- 1.1.1 strategy_timestamp
- 1.1.1 user_resolved_address
- 1.1.1 user_resolved_city
- 1.1.1 user_resolved_state
- 1.1.1 minstrategy
- 1.1.1 holiday
- 1.1.1 briefing_news
- 1.1.1 briefing_events
- 1.1.1 briefing_traffic
- 1.1.1 briefing
- 1.1.1 consolidated_strategy
- 1.1.1 ranking_id
- 1.1.1 ui
- 1.1.1 scoring_ms
- 1.1.1 planner_ms
- 1.1.1 total_ms
- 1.1.1 timed_out
- 1.1.1 path_taken
- 1.1.1 block_id
- 1.1.1 name
- 1.1.1 drive_time_min
- 1.1.1 rank
- 1.1.1 exploration_policy
- 1.1.1 was_forced
- 1.1.1 features
- 1.1.1 drive_minutes
- 1.1.1 value_grade
- 1.1.1 not_worth
- 1.1.1 trip_minutes_used
- 1.1.1 wait_minutes_used
- 1.1.1 drive_time_minutes
- 1.1.1 distance_source
- 1.1.1 pro_tips
- 1.1.1 closed_reasoning
- 1.1.1 staging_tips
- 1.1.1 staging_name
- 1.1.1 business_hours
- 1.1.1 venue_events
- 1.1.1 action_id
- 1.1.1 action
- 1.1.1 dwell_ms
- 1.1.1 from_rank
- 1.1.1 raw
- 1.1.1 venue_name
- 1.1.1 address
- 1.1.1 category
- 1.1.1 dayparts
- 1.1.1 staging_notes
- 1.1.1 metro
- 1.1.1 ai_estimated_hours
- 1.1.1 discovery_source
- 1.1.1 validated_at
- 1.1.1 suggestion_metadata
- 1.1.1 last_known_status
- 1.1.1 status_checked_at
- 1.1.1 consecutive_closed_checks
- 1.1.1 auto_suppressed
- 1.1.1 suppression_reason
- 1.1.1 times_recommended
- 1.1.1 times_chosen
- 1.1.1 positive_feedback
- 1.1.1 negative_feedback
- 1.1.1 last_verified_by_driver
- 1.1.1 request_body
- 1.1.1 result
- 1.1.1 error
- 1.1.1 kind
- 1.1.1 key
- 1.1.1 body
- 1.1.1 formatted_hours
- 1.1.1 cached_at
- 1.1.1 access_count
- 1.1.1 sentiment
- 1.1.1 comment
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
- 1.1.1 suggested_category
- 1.1.1 llm_reasoning
- 1.1.1 validation_status
- 1.1.1 place_id_found
- 1.1.1 venue_id_created
- 1.1.1 rejection_reason
- 1.1.1 llm_analysis
- 1.1.1 entry_type
- 1.1.1 content
- 1.1.1 metadata
- 1.1.1 expires_at
- 1.1.1 scope

_Source: drizzle/0006_steep_the_hood.sql_

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
- 1.1.1 with

_Source: drizzle/0000_overjoyed_human_torch.sql_

#### 1.1 venue_metrics

- 1.1.1 venue_id
- 1.1.1 times_recommended
- 1.1.1 times_chosen
- 1.1.1 positive_feedback
- 1.1.1 negative_feedback
- 1.1.1 last_verified_by_driver
- 1.1.1 with

_Source: drizzle/0000_overjoyed_human_torch.sql_

### 2. API Call

#### 2.2 Resolved in db

- `db.select(` - server/db/drizzle.js:9
- `pool.query(` - server/db/pool-lazy.js:107
- `await client.query(` - server/db/rls-middleware.js:29
- `await client.query(` - server/db/rls-middleware.js:33
- `await client.query(` - server/db/rls-middleware.js:37
- `await client.query(` - server/db/rls-middleware.js:43
- `await client.query(` - server/db/rls-middleware.js:44
- `await client.query(` - server/db/rls-middleware.js:70
- `await client.query(` - server/db/rls-middleware.js:74
- `await client.query(` - server/db/rls-middleware.js:78
- `await client.query(` - server/db/rls-middleware.js:84
- `await client.query(` - server/db/rls-middleware.js:88

### 3. Console log

- `console.log('[db] Creating local pool (shared pool disabled)` - server/db/client.js:16
- `console.error('[db] ❌ Unexpected pool error:', err.message)` - server/db/client.js:39
- `console.error('[db] Stack:', err.stack)` - server/db/client.js:40
- `console.error('[db] Database connection refused - will retry on ...)` - server/db/client.js:44
- `console.log('[db] ✅ New client connected to database')` - server/db/client.js:50
- `console.log('[db] 🔌 Client disconnected from pool')` - server/db/client.js:55
- `console.log('[db] ✅ Database connection established')` - server/db/client.js:69
- `console.log('[db] PostgreSQL version:', result.rows[0].pg_vers...)` - server/db/client.js:70
- `console.log('[db] Current time:', result.rows[0].current_time)` - server/db/client.js:71
- `console.error(`[db] ❌ Health check failed (attempt ${healthCheck...)` - server/db/client.js:75
- `console.error('[db] ❌ Database connection failed after maximum r...)` - server/db/client.js:78
- `console.error('[db] WARNING: Database not available - app will c...)` - server/db/client.js:79
- `console.error('[db] Please check DATABASE_URL and ensure Postgre...)` - server/db/client.js:80
- `console.log(`[db] Retrying health check in ${HEALTH_CHECK_RETR...)` - server/db/client.js:86
- `console.error('[db] Query error:', err.message)` - server/db/client.js:102
- `console.error('[db] Query:', args[0]?.substring?.(0, 100)` - server/db/client.js:103
- `console.log('[drizzle] Creating dedicated pool (shared pool di...)` - server/db/drizzle.js:15
- `console.log('[db-lazy] Creating pool on first use...')` - server/db/pool-lazy.js:32
- `console.error('[db-lazy] Pool error:', err.message)` - server/db/pool-lazy.js:73
- `console.error('[db-lazy] Database connection refused - will retr...)` - server/db/pool-lazy.js:75
- `console.log('[db-lazy] Client connected')` - server/db/pool-lazy.js:81
- `console.log('[db-lazy] Client removed from pool')` - server/db/pool-lazy.js:86
- `console.log(`[db-lazy] Pool created (max=${poolConfig.max}, mo...)` - server/db/pool-lazy.js:89
- `console.log('[db-lazy] Closing pool...')` - server/db/pool-lazy.js:125
- `console.log('[db-lazy] Pool closed')` - server/db/pool-lazy.js:129
- `console.log('[db-lazy] Health check OK')` - server/db/pool-lazy.js:140
- `console.log('[db-lazy] PostgreSQL:', result.rows[0].pg_version...)` - server/db/pool-lazy.js:141
- `console.error('[db-lazy] Health check failed:', err.message)` - server/db/pool-lazy.js:144
- `console.log('[pool] Shared pool disabled (PG_USE_SHARED_POOL=f...)` - server/db/pool.js:26
- `console.warn('[pool] DATABASE_URL not set, cannot create pool')` - server/db/pool.js:31
- _... and 5 more_

---

## 8. Background Jobs

### Files

- [server/jobs/event-cleanup.js](./server/jobs/event-cleanup.js) (active)
- [server/jobs/triad-worker.js](./server/jobs/triad-worker.js) (active)

### 2. API Call

#### 2.2 Resolved in db

- `await pool.query(` - server/jobs/event-cleanup.js:37
- `await db.select(` - server/jobs/triad-worker.js:68
- `await db.select(` - server/jobs/triad-worker.js:121
- `await db.select(` - server/jobs/triad-worker.js:131

### 3. Console log

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
- `console.warn('[triad-worker] ⚠️ Duplicate start suppressed (alr...)` - server/jobs/triad-worker.js:15
- `console.log(`[consolidation-listener] 🛑 Received ${signal}, c...)` - server/jobs/triad-worker.js:43
- `console.error('[consolidation-listener] ❌ Error during shutdown:...)` - server/jobs/triad-worker.js:51
- `console.log('[consolidation-listener] ✅ Listener closed cleanl...)` - server/jobs/triad-worker.js:53
- `console.log(`[consolidation-listener] 📢 Notification: strateg...)` - server/jobs/triad-worker.js:64
- `console.warn(`[consolidation-listener] ⚠️ No strategy row for $...)` - server/jobs/triad-worker.js:74
- `console.log(`[consolidation-listener] Gate for ${snapshotId}:`...)` - server/jobs/triad-worker.js:84
- `console.error(`[consolidation-listener] ❌ Consolidation failed f...)` - server/jobs/triad-worker.js:114
- `console.log(`[consolidation-listener] ✅ Consolidation complete...)` - server/jobs/triad-worker.js:118
- `console.warn(`[consolidation-listener] ⚠️ No consolidated_strat...)` - server/jobs/triad-worker.js:127
- `console.log(`[consolidation-listener] 🎯 Generating enhanced s...)` - server/jobs/triad-worker.js:138
- `console.log(`[consolidation-listener] ✅ Enhanced smart blocks ...)` - server/jobs/triad-worker.js:155
- `console.error(`[consolidation-listener] ⚠️ Blocks generation fai...)` - server/jobs/triad-worker.js:157
- `console.error(`[consolidation-listener] ❌ Error handling notific...)` - server/jobs/triad-worker.js:160
- `console.log('[consolidation-listener] 🎧 Listening on channel:...)` - server/jobs/triad-worker.js:166
- `console.error('[consolidation-listener] ❌ Failed to start listen...)` - server/jobs/triad-worker.js:168
- `console.warn('[triad-worker] ⛔ Hot polling is disabled. Use sta...)` - server/jobs/triad-worker.js:178

---

## 9. Eidolon SDK

### Files

- [server/eidolon/config.ts](./server/eidolon/config.ts) (active)
- [server/eidolon/core/code-map.ts](./server/eidolon/core/code-map.ts) (active)
- [server/eidolon/core/context-awareness.ts](./server/eidolon/core/context-awareness.ts) (active)
- [server/eidolon/core/deep-thinking-engine.ts](./server/eidolon/core/deep-thinking-engine.ts) (active)
- [server/eidolon/core/deployment-tracker.ts](./server/eidolon/core/deployment-tracker.ts) (active)
- [server/eidolon/core/llm.ts](./server/eidolon/core/llm.ts) (active)
- [server/eidolon/core/memory-enhanced.ts](./server/eidolon/core/memory-enhanced.ts) (active)
- [server/eidolon/core/memory-store.ts](./server/eidolon/core/memory-store.ts) (active)
- [server/eidolon/index.ts](./server/eidolon/index.ts) (active) → UI: [index-BzKHz2OF.js](./client/dist/assets/index-BzKHz2OF.js)
- [server/eidolon/memory/compactor.js](./server/eidolon/memory/compactor.js) (active)
- [server/eidolon/memory/pg.js](./server/eidolon/memory/pg.js) (active)
- [server/eidolon/policy-loader.js](./server/eidolon/policy-loader.js) (active)
- [server/eidolon/policy-middleware.js](./server/eidolon/policy-middleware.js) (active)

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
- `.map(` - server/eidolon/memory/pg.js:132
- `.filter(` - server/eidolon/policy-middleware.js:24

#### 2.2 Resolved in db

- `await pool.query(` - server/eidolon/memory/pg.js:144
- `await client.query(` - server/eidolon/memory/pg.js:39
- `await client.query(` - server/eidolon/memory/pg.js:55
- `await client.query(` - server/eidolon/memory/pg.js:65
- `await client.query(` - server/eidolon/memory/pg.js:82
- `await client.query(` - server/eidolon/memory/pg.js:96
- `await client.query(` - server/eidolon/memory/pg.js:116
- `await client.query(` - server/eidolon/memory/pg.js:130

### 3. Console log

- `console.warn(`Cannot scan directory ${dir}:`, err)` - server/eidolon/core/code-map.ts:37
- `console.warn(`Cannot scan file ${filePath}:`, err)` - server/eidolon/core/code-map.ts:53
- `console.warn('Could not persist code map:', err)` - server/eidolon/core/code-map.ts:172
- `console.warn('Could not scan components:', err)` - server/eidolon/core/context-awareness.ts:86
- `console.log(`🧠 [DeepThinking] Starting comprehensive analysis...)` - server/eidolon/core/deep-thinking-engine.ts:8
- `console.log(`✅ [DeepThinking] Reached confidence threshold at ...)` - server/eidolon/core/deep-thinking-engine.ts:33
- `console.log(`🎯 [DeepThinking] Analysis complete. Confidence: ...)` - server/eidolon/core/deep-thinking-engine.ts:41
- `console.warn(`Could not delete memory ${name}:`, err)` - server/eidolon/core/memory-store.ts:62
- `console.info("[memory] compaction complete")` - server/eidolon/memory/compactor.js:12
- `console.error("[memory] compaction error:", e?.message || e)` - server/eidolon/memory/compactor.js:14
- `console.log('[memory] Using local pool (shared pool disabled)` - server/eidolon/memory/pg.js:10
- `console.warn(`[policy] Could not load from ${path}: ${e.message...)` - server/eidolon/policy-loader.js:13

---

## Workflow Summary

| Subcategory | Files | Active | Not Active | Schemas | API Calls | Console Logs |
|-------------|-------|--------|------------|---------|-----------|-------------|
| 1. Entry Points | 3 | 3 | 0 | 0 | 28 | 80 |
| 10. Gateway | 1 | 1 | 0 | 0 | 0 | 1 |
| 11. Scripts & Utils | 29 | 6 | 23 | 16 | 47 | 428 |
| 12. Shared | 9 | 9 | 0 | 21 | 9 | 5 |
| 13. Other Workflow | 20 | 20 | 0 | 0 | 58 | 47 |
| 2. Bootstrap & Init | 1 | 1 | 0 | 0 | 3 | 5 |
| 3. Middleware | 10 | 10 | 0 | 0 | 7 | 10 |
| 4. Routes & API | 24 | 24 | 0 | 0 | 142 | 244 |
| 5. Core Logic | 81 | 81 | 0 | 0 | 212 | 396 |
| 7. Database | 29 | 9 | 20 | 25 | 12 | 35 |
| 8. Background Jobs | 2 | 2 | 0 | 0 | 4 | 30 |
| 9. Eidolon SDK | 13 | 13 | 0 | 0 | 30 | 12 |
