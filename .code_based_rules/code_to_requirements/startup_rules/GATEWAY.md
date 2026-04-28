# Engineering Specification: Gateway Server Bootstrap

## 1. Scope

This specification defines the functional, operational, security, reliability, and observability requirements for the gateway server bootstrap process, including environment initialization, HTTP server setup, middleware and route mounting, background task control, health monitoring, and shutdown behavior.

## 2. System purpose

The gateway server shall:
- initialize and validate runtime configuration
- bootstrap an Express-based HTTP application
- expose health, diagnostic, application, and capability endpoints
- enforce safe startup ordering
- conditionally enable long-lived or background behaviors based on deployment mode
- support graceful shutdown and runtime monitoring

---

## 3. Functional requirements

### 3.1 Environment initialization

#### FR-ENV-001
The system shall load environment configuration before any application bootstrap logic proceeds.

#### FR-ENV-002
The system shall validate required environment variables before completing startup.

#### FR-ENV-003
The system shall terminate startup if environment validation fails.

#### FR-ENV-004
The application mode shall default to `mono` when `APP_MODE` is unset.

#### FR-ENV-005
The listening port shall default to `5000` when `PORT` is unset.

#### FR-ENV-006
The application mode value shall be normalized to lowercase before use.

---

### 3.2 Deployment mode detection

#### FR-DEP-001
The system shall detect deployment mode from `REPLIT_DEPLOYMENT`.

#### FR-DEP-002
The system shall detect autoscale mode when either `CLOUD_RUN_AUTOSCALE=1` or `REPLIT_AUTOSCALE=1`.

#### FR-DEP-003
Autoscale detection shall treat each autoscale flag independently.

#### FR-DEP-004
When autoscale mode is active, the system shall disable:
- server-sent events
- snapshot workflow observation
- background worker execution within the gateway process

#### FR-DEP-005
When autoscale mode is active, the system shall emit a prominent warning in logs describing the disabled features.

---

### 3.3 Application bootstrap

#### FR-BOOT-001
The system shall create an Express application instance during bootstrap.

#### FR-BOOT-002
The system shall set `trust proxy` to `1`.

#### FR-BOOT-003
The system shall configure lightweight health endpoints before heavy module loading.

#### FR-BOOT-004
The system shall mount the health router before general application routes.

#### FR-BOOT-005
The system shall create an HTTP server from the Express application.

#### FR-BOOT-006
The system shall export the application instance as a live binding for tests and importers.

#### FR-BOOT-007
The system shall assign the application instance to `globalThis.testApp` during bootstrap.

---

### 3.4 Middleware and route mounting

#### FR-ROUTE-001
The system shall serve static assets from the resolved client distribution directory.

#### FR-ROUTE-002
The system shall configure middleware before accepting requests.

#### FR-ROUTE-003
Configured middleware shall include, at minimum, security and parsing layers referenced by bootstrap comments, including:
- CORS
- Helmet
- body parsing

#### FR-ROUTE-004
The system shall mount SSE routes only when autoscale mode is not active.

#### FR-ROUTE-005
The system shall mount application routes only when `MODE === 'mono'`.

#### FR-ROUTE-006
The system shall configure the error handler after all routes are mounted.

#### FR-ROUTE-007
The system shall mount unified capabilities endpoints during bootstrap.

#### FR-ROUTE-008
The SPA catch-all route shall be mounted last.

#### FR-ROUTE-009
The SPA catch-all route shall not intercept requests beginning with:
- `/api/`
- `/agent/`

---

### 3.5 API endpoint requirements

#### FR-API-001
The system shall expose a diagnostic endpoint at `/api/diagnostic/db-info`.

#### FR-API-002
The diagnostic endpoint shall return:
- environment detection values
- deployment-relevant runtime mode
- database target label
- masked database host information
- whether `DATABASE_URL` is present
- a timestamp

#### FR-API-003
The system shall mask sensitive portions of the database connection string before returning host information.

#### FR-API-004
The system shall expose a unified capabilities endpoint at `/api/unified/capabilities`.

#### FR-API-005
The unified capabilities endpoint shall return:
- `ok`
- system identifier
- model
- context window
- thinking mode
- runtime capability data

---

### 3.6 Server activation

#### FR-SRV-001
The system shall begin listening only after middleware and routes are fully mounted.

#### FR-SRV-002
The system shall bind to `0.0.0.0` on the configured port.

#### FR-SRV-003
The system shall only call `server.listen()` when the module is the active entrypoint.

#### FR-SRV-004
On successful listen, the system shall log the listening address and bootstrap completion timing.

---

### 3.7 Background execution

#### FR-BG-001
The system shall determine worker startup eligibility through centralized worker decision logic.

#### FR-BG-002
The system shall start the strategy worker only if worker startup is allowed.

#### FR-BG-003
When worker startup is disallowed, the system shall log the reason.

#### FR-BG-004
Worker startup shall occur after server startup logic is established and shall not block listening.

#### FR-BG-005
The gateway shall not start event sync during server startup.

#### FR-BG-006
The system shall conditionally load and run snapshot workflow observation only when autoscale mode is inactive.

#### FR-BG-007
Snapshot observer import failures and runtime failures shall be logged as warnings and shall not terminate the process.

---

### 3.8 Monitoring

#### FR-MON-001
The system shall start unified AI health monitoring after the server begins listening.

#### FR-MON-002
The system shall perform an immediate initial health check.

#### FR-MON-003
The system shall perform recurring health checks every 30 seconds.

#### FR-MON-004
Health check failures shall be logged without crashing the process.

#### FR-MON-005
If the initial health check indicates an unhealthy state, the system shall log the reported issues.

---

### 3.9 Shutdown behavior

#### FR-SD-001
The system shall handle `SIGINT` and `SIGTERM`.

#### FR-SD-002
On shutdown, the system shall log the received signal.

#### FR-SD-003
On shutdown, the system shall terminate child processes before final process exit.

#### FR-SD-004
On shutdown, the system shall close the HTTP server and exit cleanly with status `0`.

---

## 4. Security requirements

### 4.1 Startup ordering security

#### SEC-001
The system shall not accept traffic before security-relevant middleware and route handlers are mounted.

#### SEC-002
The startup sequence shall prevent any window in which requests can arrive without expected protections such as:
- CORS handling
- Helmet protections
- authentication or route enforcement, where configured downstream

### 4.2 Information exposure

#### SEC-003
Sensitive database credentials shall not be returned in diagnostic responses.

#### SEC-004
Only masked host-level database targeting information may be exposed through diagnostics.

### 4.3 Route isolation

#### SEC-005
The SPA catch-all route shall not override API or agent route handling.

---

## 5. Operational requirements

### 5.1 Runtime configuration

#### OPS-001
The system shall support mono-mode runtime behavior.

#### OPS-002
The system shall resolve the client distribution directory relative to the module location.

#### OPS-003
The system shall distinguish between deployment mode and autoscale mode in logs and behavior.

### 5.2 Timeout configuration

#### OPS-004
The HTTP server shall set:
- `keepAliveTimeout = 65000`
- `headersTimeout = 66000`
- `requestTimeout = 5000`

### 5.3 Warning management

#### OPS-005
The system shall suppress only the known PostgreSQL SSL-mode deprecation warning string identified in the source.

#### OPS-006
All other warnings shall continue through the normal warning pipeline.

### 5.4 Logging

#### OPS-007
The system shall log:
- bootstrap start
- process ID
- mode
- port
- deployment state
- autoscale state
- middleware and route loading progress
- SSE disablement in autoscale mode
- worker start or skip outcome
- listening success
- bootstrap duration
- shutdown signals
- monitoring startup
- health check issues and failures

---

## 6. Reliability requirements

### 6.1 Error handling

#### REL-001
The system shall install a global `uncaughtException` handler.

#### REL-002
The system shall install a global `unhandledRejection` handler.

#### REL-003
The system shall log uncaught exceptions.

#### REL-004
The system shall log unhandled promise rejections, including the promise reference and rejection reason.

#### REL-005
In non-production environments, uncaught exceptions shall terminate the process.

#### REL-006
Fatal bootstrap errors shall terminate the process with exit status `1`.

#### REL-007
HTTP server errors shall terminate the process with exit status `1`.

### 6.2 Degraded operation

#### REL-008
Failures in snapshot observer loading or execution shall not prevent core gateway availability.

#### REL-009
Failures in periodic unified AI health checks shall not terminate the application.

---

## 7. Non-functional requirements

### 7.1 Maintainability

#### NFR-MAINT-001
Bootstrap responsibilities shall remain modularized across dedicated bootstrap modules for:
- health
- middleware
- routes
- workers

#### NFR-MAINT-002
The entrypoint shall act primarily as an orchestration layer rather than embedding all subsystem logic inline.

### 7.2 Observability

#### NFR-OBS-001
The system shall provide sufficient structured runtime logging to diagnose startup mode, disabled features, and lifecycle progress.

#### NFR-OBS-002
The system shall expose explicit health and capability visibility endpoints.

### 7.3 Testability

#### NFR-TEST-001
The application instance shall be available for tests through exported bindings.

#### NFR-TEST-002
The bootstrap process shall expose a global application reference for test access.

### 7.4 Availability

#### NFR-AVAIL-001
Core HTTP serving shall start independently of optional background observer workloads.

#### NFR-AVAIL-002
Optional background and monitoring failures shall degrade gracefully where explicitly designed to do so.

---

## 8. Required startup sequence

The implementation shall follow this startup order:

1. load environment
2. validate environment
3. detect runtime mode and deployment state
4. create Express app
5. configure early health endpoints
6. mount health router
7. create HTTP server
8. serve static assets
9. configure middleware
10. mount SSE if allowed
11. mount application routes in mono mode
12. configure error handler
13. mount unified capabilities
14. mount SPA catch-all
15. start listening when running as entrypoint
16. start monitoring after listen
17. evaluate and start worker if eligible
18. start snapshot observer only when allowed

---

## 9. Explicit prohibitions

The implementation shall not:
- start listening before middleware and routes are mounted
- expose raw database credentials
- run SSE in autoscale mode
- run snapshot observation in autoscale mode
- start workers when worker eligibility logic disallows it
- intercept `/api/*` or `/agent/*` requests with the SPA fallback
- swallow warnings unrelated to the specific PostgreSQL SSL-mode warning

---

## 10. Acceptance criteria

The system is compliant if all of the following are true:

- startup fails when required environment validation fails
- health endpoints are reachable before heavier runtime functionality is loaded
- middleware and routes are active before the first accepted request
- autoscale mode disables SSE, worker execution, and snapshot observation
- diagnostic and unified capability endpoints return the required fields
- HTTP server timeouts match the configured values
- health monitoring starts after successful bind and repeats every 30 seconds
- shutdown on `SIGINT` and `SIGTERM` closes children and the HTTP server cleanly
- fatal startup and server errors terminate the process
- the SPA catch-all is last and excludes API and agent paths