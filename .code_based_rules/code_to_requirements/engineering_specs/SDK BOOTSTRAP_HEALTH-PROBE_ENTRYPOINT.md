# Engineering Specification: SDK Bootstrap and Health-Probe Entrypoint

## 1. Scope

This specification defines the functional, operational, security, reliability, and non-functional requirements for the SDK bootstrap entrypoint, including early health-probe readiness, deferred application loading, request-handler hot-swapping, route and middleware initialization, timeout policy, logging, and graceful shutdown.

## 2. System purpose

The SDK bootstrap entrypoint shall:
- start listening quickly for platform health probes
- expose immediate health and readiness responses before full application initialization
- defer heavy dependency loading until after the server is listening
- hot-swap from a lightweight HTTP responder to the full Express application
- mount middleware and API routes after lazy initialization completes
- remain available for health checks even if post-listen initialization fails
- support graceful shutdown and diagnostic logging

---

## 3. Functional requirements

### 3.1 Bootstrap logging and startup diagnostics

#### FR-BOOT-001
The system shall emit a boot marker log at startup.

#### FR-BOOT-002
The boot marker shall include runtime diagnostics sufficient to prove process startup, including:
- current working directory
- module path
- process arguments
- Node version
- process ID

#### FR-BOOT-003
If boot-marker logging fails, the system shall emit a fallback boot-marker log message.

#### FR-BOOT-004
The system shall log effective host and port configuration before attempting to listen.

---

### 3.2 Host and port resolution

#### FR-CONFIG-001
The listening port shall be resolved from CLI arguments before environment variables.

#### FR-CONFIG-002
The port resolution order shall be:
1. `--port=...`
2. `EIDOLON_PORT`
3. `SDK_PORT`
4. default `3102`

#### FR-CONFIG-003
The listening host shall be resolved from:
1. `--host=...`
2. `HOST`
3. default `0.0.0.0`

#### FR-CONFIG-004
The entrypoint shall not use `process.env.PORT` as the binding source for this SDK listener.

#### FR-CONFIG-005
The system shall log both resolved values and relevant environment variables at startup for debugging.

---

### 3.3 Immediate health-probe responder

#### FR-RESP-001
The system shall create a lightweight HTTP server before loading the full application stack.

#### FR-RESP-002
The initial responder shall return HTTP 200 for:
- `HEAD /`
- `HEAD /health`
- `GET /`
- `GET /health`
- `GET /ready`

#### FR-RESP-003
The initial responder shall return plain-text success responses for health endpoints.

#### FR-RESP-004
The initial responder shall return a success response even for non-health routes during shim mode.

#### FR-RESP-005
The initial responder shall make the process probe-ready before heavy module loading begins.

---

### 3.4 HTTP server initialization

#### FR-SRV-001
The system shall create the server using Node's HTTP server API.

#### FR-SRV-002
The system shall set:
- `requestTimeout = 5000`
- `headersTimeout = 6000`
- `keepAliveTimeout = 5000`

#### FR-SRV-003
The system shall begin listening immediately after lightweight server creation.

#### FR-SRV-004
On the `listening` event, the system shall log the effective bound address.

#### FR-SRV-005
On the `listening` event, the system shall log that health-probe endpoints are ready.

#### FR-SRV-006
If a listen error occurs with `EADDRINUSE`, the process shall treat it as fatal and exit with status `1`.

---

### 3.5 Deferred application initialization

#### FR-LAZY-001
The system shall defer heavy initialization until after the initial server is already listening.

#### FR-LAZY-002
Deferred initialization shall begin asynchronously using a post-listen scheduling mechanism.

#### FR-LAZY-003
The full application stack shall be loaded using dynamic imports.

#### FR-LAZY-004
The system shall create an Express application during deferred initialization.

#### FR-LAZY-005
The Express application shall set `trust proxy` to `1`.

#### FR-LAZY-006
The full application shall preserve fast-path responses for:
- `GET /`
- `HEAD /`
- `GET /health`
- `HEAD /health`
- `GET /ready`

#### FR-LAZY-007
The full application shall log incoming health-probe requests for:
- `GET /`
- `HEAD /`
- `GET /health`
- `HEAD /health`
- `GET /ready`

---

### 3.6 Middleware initialization

#### FR-MW-001
The full application shall mount middleware after deferred imports complete.

#### FR-MW-002
Mounted middleware shall include:
- CORS middleware
- request logging middleware
- security middleware

#### FR-MW-003
Middleware shall be mounted before API route registration completes.

---

### 3.7 API route initialization

#### FR-API-001
The full application shall mount route modules for the SDK API surface.

#### FR-API-002
Mounted routes shall include:
- `/api/health`
- `/api/location`
- `/api/actions`
- `/api/research`
- `/api/feedback`
- `/api/diagnostics`
- `/api/snapshot`
- `/api/job-metrics`
- `/api/ml-health`
- `/api/chat`
- `/api/auth`
- `/api/intelligence`

#### FR-API-003
The system shall expose a quick status endpoint at `/api/copilot`.

#### FR-API-004
The `/api/copilot` endpoint shall return JSON indicating:
- success status
- active status
- copilot identity
- capability list
- timestamp

#### FR-API-005
The full application shall return JSON `404` responses for unknown routes after route mounting completes.

---

### 3.8 Handler hot-swap behavior

#### FR-SWAP-001
After the full application is initialized, the system shall replace the lightweight responder with the Express handler.

#### FR-SWAP-002
The hot-swap shall occur without restarting the listening server.

#### FR-SWAP-003
The system shall remove prior `request` listeners before binding the Express handler.

#### FR-SWAP-004
The system shall log successful completion of the request-handler swap.

#### FR-SWAP-005
The system shall log that the full application is ready after successful swap.

---

### 3.9 Degraded post-listen behavior

#### FR-DEG-001
If deferred initialization fails, the process shall log the failure.

#### FR-DEG-002
If deferred initialization fails, the initial health-probe responder shall remain active.

#### FR-DEG-003
If deferred initialization fails, the process shall not terminate automatically solely because routes failed to load.

#### FR-DEG-004
If deferred initialization fails, the system shall explicitly log that health probes remain active while application routes are unavailable.

---

### 3.10 Shutdown behavior

#### FR-SD-001
The system shall handle shutdown signals:
- `SIGTERM`
- `SIGINT`
- `SIGQUIT`

#### FR-SD-002
On shutdown, the system shall log the received signal.

#### FR-SD-003
On shutdown, the system shall close the HTTP server gracefully when available.

#### FR-SD-004
After graceful server close, the process shall exit with status `0`.

#### FR-SD-005
If no server reference is available, the process shall still exit cleanly with status `0`.

---

## 4. Security requirements

### 4.1 Binding and deployment safety

#### SEC-001
The SDK listener shall bind to `0.0.0.0` by default to support containerized or Cloud Run-style environments.

#### SEC-002
The SDK listener shall not bind to an unrelated port source such as `process.env.PORT` when that may belong to another service.

### 4.2 Middleware and request safety

#### SEC-003
The full application shall apply CORS, logging, and security middleware before serving the mounted API surface.

#### SEC-004
The application shall enable trusted proxy behavior explicitly through `trust proxy`.

### 4.3 Failure containment

#### SEC-005
Listen failures caused by port conflicts shall be treated as fatal.

#### SEC-006
Deferred initialization failures shall not expose a partially mounted application handler.

---

## 5. Operational requirements

### 5.1 Startup behavior

#### OPS-001
The service shall optimize for immediate probe readiness before full dependency loading.

#### OPS-002
The service shall log configuration, listen lifecycle, lazy-load progress, and handler-swap completion.

#### OPS-003
The service shall distinguish between:
- lightweight health-only operation
- full application-ready operation
- degraded post-listen operation

### 5.2 Probe support

#### OPS-004
The service shall support health and readiness probes on:
- `/`
- `/health`
- `/ready`

#### OPS-005
The service shall support both `GET` and `HEAD` behavior for primary health endpoints where defined.

### 5.3 API availability

#### OPS-006
The service shall continue answering health probes even if lazy route initialization fails.

#### OPS-007
The service shall expose a machine-readable status endpoint for copilot capability checks.

---

## 6. Reliability requirements

### 6.1 Runtime stability

#### REL-001
The system shall install a global `uncaughtException` handler.

#### REL-002
The system shall install a global `unhandledRejection` handler.

#### REL-003
The system shall log uncaught exceptions.

#### REL-004
The system shall log unhandled promise rejections.

#### REL-005
The process shall remain observable through logs during both successful and degraded startup paths.

### 6.2 Graceful degradation

#### REL-006
The service shall prioritize liveness and readiness signaling over immediate full-stack availability.

#### REL-007
Deferred import or route-mount failures shall degrade the service to health-only mode rather than unconditionally crashing the process.

#### REL-008
The hot-swap architecture shall allow the listener to stay active while application initialization completes asynchronously.

---

## 7. Non-functional requirements

### 7.1 Availability

#### NFR-AVAIL-001
The service shall minimize time-to-first-listen for orchestration health checks.

#### NFR-AVAIL-002
The service shall be capable of reporting healthy probe responses before heavy dependencies are loaded.

#### NFR-AVAIL-003
The service shall preserve probe responsiveness during deferred initialization failures.

### 7.2 Observability

#### NFR-OBS-001
The service shall provide clear lifecycle logs for:
- boot proof
- configuration
- listen start
- listen success
- lazy initialization
- handler swap
- shutdown
- uncaught runtime failures

#### NFR-OBS-002
Probe traffic should be visible in logs for supported health endpoints.

### 7.3 Maintainability

#### NFR-MAINT-001
Heavy dependencies should be isolated behind lazy-loading boundaries.

#### NFR-MAINT-002
Middleware and route composition should remain modular through dynamic imports.

#### NFR-MAINT-003
The bootstrap file shall act as an orchestration layer for early readiness and application assembly.

### 7.4 Performance

#### NFR-PERF-001
The system should defer nonessential startup cost until after the listener is live.

#### NFR-PERF-002
The lightweight shim responder should remain minimal and low-overhead.

---

## 8. Required startup sequence

The implementation shall follow this startup order:

1. emit boot-proof logging
2. resolve host and port from CLI arguments and environment
3. log effective configuration
4. create lightweight HTTP responder
5. create HTTP server and apply timeout settings
6. attach error and listening handlers
7. begin listening immediately
8. confirm probe readiness in logs
9. schedule deferred initialization
10. dynamically import Express, middleware, and route modules
11. mount middleware
12. mount route modules
13. register status and fallback handlers
14. replace shim request handling with the Express application
15. continue normal operation
16. on signal, close the server gracefully and exit

---

## 9. Explicit prohibitions

The implementation shall not:
- bind to `process.env.PORT` for this SDK listener
- delay listening until all heavy modules are loaded
- fail health probes solely because deferred route initialization has not completed
- leave both shim and full application request handlers active simultaneously after swap
- silently ignore port-collision errors
- terminate the process automatically on deferred initialization failure when health-only operation is still possible

---

## 10. Acceptance criteria

The system is compliant if all of the following are true:

- startup logs include a boot marker and effective host/port configuration
- the service binds using CLI or SDK-specific environment settings, defaulting to host `0.0.0.0` and port `3102`
- health endpoints respond successfully before full application initialization completes
- the listener starts before heavy module imports begin
- Express, middleware, and API routes are loaded asynchronously after listen
- the server hot-swaps from shim responder to Express without a restart
- `/api/copilot` returns structured JSON status
- unknown routes return JSON `404` after full application load
- `EADDRINUSE` causes a fatal exit
- deferred initialization failures preserve health-probe availability
- `SIGTERM`, `SIGINT`, and `SIGQUIT` trigger graceful shutdown
- uncaught exceptions and unhandled rejections are logged