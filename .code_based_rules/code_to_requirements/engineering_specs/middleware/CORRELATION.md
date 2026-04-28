# Engineering Specification: Correlation ID Middleware

## 1. Scope

This specification defines the requirements for correlation ID generation and propagation across requests and responses.

## 2. System purpose

The correlation ID middleware shall:
- accept an inbound correlation identifier when present
- generate a new identifier when absent
- attach the identifier to the request object
- echo the identifier in the response headers

---

## 3. Functional requirements

#### FR-CID-001
The middleware shall read the inbound `x-correlation-id` request header.

#### FR-CID-002
If no inbound correlation ID is provided, the middleware shall generate a UUID.

#### FR-CID-003
The middleware shall assign the resolved identifier to `req.cid`.

#### FR-CID-004
The middleware shall set the `x-correlation-id` response header.

#### FR-CID-005
The middleware shall call `next()` after attaching the identifier.

## 4. Security requirements

#### SEC-001
The middleware shall avoid leaving requests without a correlation identifier.

## 5. Operational requirements

#### OPS-001
The middleware shall preserve caller-supplied correlation IDs when present.

#### OPS-002
The middleware shall provide a generated fallback for observability when none is supplied.

## 6. Reliability requirements

#### REL-001
Every request traversing the middleware shall emerge with a usable correlation identifier.

## 7. Non-functional requirements

#### NFR-OBS-001
The middleware shall support traceability across logs, request handling, and responses.

#### NFR-MAINT-001
The implementation shall remain minimal and side-effect limited.

## 8. Acceptance criteria

The middleware is compliant if all of the following are true:
- inbound `x-correlation-id` is preserved when present
- a UUID is generated when absent
- `req.cid` is set
- the response contains `x-correlation-id`
```

---

```markdown id="middleware-error-handler-spec-md"
# Engineering Specification: Error Handler Middleware

## 1. Scope

This specification defines the requirements for centralized HTTP error translation, including degraded-database handling, payload-too-large handling, correlation ID propagation, retry signaling, and generic internal-error responses.

## 2. System purpose

The error handler shall:
- translate known degraded-service conditions into HTTP `503`
- surface payload-too-large failures as HTTP `413`
- emit structured error logs with correlation IDs
- return generic HTTP `500` responses for unhandled errors
- avoid double-writing responses after headers are sent

---

## 3. Functional requirements

### 3.1 Correlation handling

#### FR-ERR-001
The middleware shall resolve a correlation identifier from `req.cid`, inbound `x-correlation-id`, or the fallback value `unknown`.

### 3.2 Degraded-service translation

#### FR-ERR-002
If the error message is `db_degraded` or the error status is `503`, the middleware shall return HTTP `503`.

#### FR-ERR-003
For degraded-service responses, the middleware shall compute `Retry-After` from the current database backoff delay, defaulting to 2 seconds when needed.

#### FR-ERR-004
The middleware shall set the `Retry-After` response header for degraded-service responses.

#### FR-ERR-005
The degraded-service JSON response shall include:
- `cid`
- `state: "degraded"`
- an error message
- `retry_after`

### 3.3 Payload-too-large translation

#### FR-ERR-006
If the error type is `entity.too.large`, the middleware shall return HTTP `413`.

#### FR-ERR-007
The payload-too-large JSON response shall include:
- `cid`
- a user-facing error message
- `code: "payload_too_large"`

### 3.4 Generic unhandled error translation

#### FR-ERR-008
If the response headers have already been sent, the middleware shall delegate to `next(err)`.

#### FR-ERR-009
Unhandled errors not matched by specialized cases shall return HTTP `500`.

#### FR-ERR-010
The generic internal-error JSON response shall include:
- `cid`
- `error: "Internal server error"`

## 4. Security requirements

#### SEC-001
Unhandled server errors shall not expose raw internal details in client-facing responses.

#### SEC-002
Special degraded-service conditions shall provide retry guidance without exposing unnecessary internals.

## 5. Operational requirements

#### OPS-001
The middleware shall emit structured NDJSON logs for `503`, `413`, and `500` conditions.

#### OPS-002
The middleware shall include correlation IDs in structured logs.

#### OPS-003
The middleware shall log unhandled errors to stderr or console for diagnosis.

## 6. Reliability requirements

#### REL-001
The middleware shall avoid sending multiple responses when headers have already been committed.

#### REL-002
Known error classes shall be translated deterministically to stable HTTP responses.

## 7. Non-functional requirements

#### NFR-OBS-001
The middleware shall support correlation-aware incident diagnosis.

#### NFR-USE-001
Client-facing error bodies should remain concise and actionable.

#### NFR-SEC-001
Internal stack detail should remain in logs rather than client responses.

## 8. Acceptance criteria

The middleware is compliant if all of the following are true:
- degraded database conditions return `503` with `Retry-After`
- payload-too-large conditions return `413`
- generic unhandled errors return `500`
- correlation IDs appear in error responses and logs
- `next(err)` is used when headers are already sent
```