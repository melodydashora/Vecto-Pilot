# Engineering Specification: Timeout Middleware

## 1. Scope

This specification defines the requirements for request and response timeout enforcement across general API routes and longer-running LLM-related routes.

## 2. System purpose

The timeout middleware shall:
- apply route-sensitive timeout budgets
- enforce both request and response timeout callbacks
- return gateway-timeout responses when time limits are exceeded
- preserve shorter defaults for ordinary API routes and longer limits for LLM-style routes

---

## 3. Functional requirements

#### FR-TIME-001
The middleware shall determine timeout duration based on request path.

#### FR-TIME-002
The default timeout shall be 180000 ms.

#### FR-TIME-003
Ordinary `/api/` routes shall use a 120000 ms timeout.

#### FR-TIME-004
Routes containing `/api/blocks` or `/api/research` shall use a 180000 ms timeout.

#### FR-TIME-005
The middleware shall apply the selected timeout to both `req.setTimeout()` and `res.setTimeout()`.

#### FR-TIME-006
When a request timeout fires and headers are not yet sent, the middleware shall return HTTP `504` with a JSON gateway-timeout payload.

#### FR-TIME-007
When a response timeout fires and headers are not yet sent, the middleware shall return HTTP `504` with a JSON gateway-timeout payload.

#### FR-TIME-008
The middleware shall call `next()` after setting timeout handlers.

## 4. Security requirements

#### SEC-001
The middleware shall guard against indefinitely hanging request or response processing.

## 5. Operational requirements

#### OPS-001
Timeout events shall be logged with timeout duration, HTTP method, and request path.

#### OPS-002
Gateway-timeout responses shall be machine-readable JSON.

## 6. Reliability requirements

#### REL-001
Timeout responses shall not attempt to write if response headers have already been sent.

#### REL-002
Route-specific timeout selection shall be deterministic based on the request path.

## 7. Non-functional requirements

#### NFR-PERF-001
The middleware shall support longer time budgets for expensive or LLM-like endpoints.

#### NFR-AVAIL-001
The middleware shall improve service resilience by bounding hung work.

## 8. Acceptance criteria

The middleware is compliant if all of the following are true:
- `/api/` routes use 120s unless explicitly promoted to the LLM timeout class
- `/api/blocks` and `/api/research` routes use 180s
- request and response timeouts both return `504` when possible
- timeout events are logged
```

