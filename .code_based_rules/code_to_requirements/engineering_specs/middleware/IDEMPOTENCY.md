# Engineering Specification: Idempotency Middleware

## 1. Scope

This specification defines the requirements for request idempotency using an idempotency header, database-backed response replay, TTL-based lookup, and response capture for cacheable outcomes.

## 2. System purpose

The idempotency middleware shall:
- detect repeat requests using an idempotency key
- replay previously stored responses inside a time window
- capture successful or deterministic client-error responses for reuse
- avoid breaking request processing when persistence fails

---

## 3. Functional requirements

### 3.1 Key handling

#### FR-IDEM-001
The middleware shall read the idempotency key from a configurable request header.

#### FR-IDEM-002
The default idempotency header shall be `x-idempotency-key`.

#### FR-IDEM-003
If no idempotency key is present, the middleware shall continue without interception.

### 3.2 Replay lookup

#### FR-IDEM-004
The middleware shall look up prior idempotency records in the persistence table within a configurable TTL window.

#### FR-IDEM-005
The default TTL shall be 60 seconds.

#### FR-IDEM-006
If a prior matching record exists within TTL, the middleware shall return the stored status code and stored body immediately.

### 3.3 Response capture

#### FR-IDEM-007
The middleware shall intercept `res.json` and `res.send` to capture the first outgoing response body.

#### FR-IDEM-008
The middleware shall only persist cacheable outcomes, including:
- `2xx` success responses
- `202` accepted responses
- deterministic `400` responses

#### FR-IDEM-009
Non-object `send()` bodies may be wrapped as text payloads for persistence.

#### FR-IDEM-010
The middleware shall prevent duplicate capture of the same response.

#### FR-IDEM-011
Persistence conflicts shall not crash the request flow.

## 4. Security requirements

#### SEC-001
Idempotency replay shall only apply when an explicit client-supplied key is present.

#### SEC-002
The middleware shall not broaden replay behavior beyond the configured TTL window.

## 5. Operational requirements

#### OPS-001
The middleware shall support configurable header name and TTL.

#### OPS-002
Persistence failures during save shall be logged as warnings.

#### OPS-003
Top-level middleware failures shall be logged and delegated downstream rather than terminating the request.

## 6. Reliability requirements

#### REL-001
Replay hits shall return stable stored status and body.

#### REL-002
Failure to persist a captured response shall not prevent the original response from being returned.

#### REL-003
Errors inside the middleware shall fall through to `next()` rather than hanging the request.

## 7. Non-functional requirements

#### NFR-MAINT-001
The middleware shall encapsulate replay lookup and response capture behind a configurable factory.

#### NFR-USE-001
The middleware should support safe client retries for duplicate submissions.

#### NFR-OBS-001
Persistence failures should be visible in logs.

## 8. Acceptance criteria

The middleware is compliant if all of the following are true:
- requests without an idempotency key pass through unchanged
- repeat keyed requests inside TTL replay stored responses
- `2xx`, `202`, and `400` responses are eligible for capture
- persistence failures do not break the original response flow
```

---

```markdown id="middleware-learning-capture-spec-md"
# Engineering Specification: Learning Capture Middleware

## 1. Scope

This specification defines the requirements for ML-learning event capture, including event typing, event ID generation, non-blocking middleware capture, error capture, and graceful failure behavior.

## 2. System purpose

The learning-capture middleware shall:
- capture structured learning events for important system interactions
- generate stable event metadata including IDs and timestamps
- attach request and response context for successful interactions
- support asynchronous capture so response flow is not blocked
- capture error context for later analysis

---

## 3. Functional requirements

### 3.1 Learning event model

#### FR-LEARN-001
The module shall define named learning event types for major workflow milestones.

#### FR-LEARN-002
Captured events shall include:
- `event_id`
- `event_type`
- `timestamp`
- `user_id`
- `data`
- `captured_at`

#### FR-LEARN-003
Event IDs shall be generated as UUIDs.

### 3.2 Direct event capture

#### FR-LEARN-004
The capture function shall accept an event type, event data, and optional user ID.

#### FR-LEARN-005
The capture function shall log captured event metadata when persistence is not yet available.

#### FR-LEARN-006
Missing user IDs shall be surfaced as a bug indicator in logs rather than masked as anonymous.

#### FR-LEARN-007
Capture failures shall return `null` rather than throwing.

### 3.3 Response-driven middleware capture

#### FR-LEARN-008
The middleware factory shall wrap `res.json` to observe successful responses.

#### FR-LEARN-009
The middleware shall only capture events for successful responses where:
- HTTP status is `2xx`
- the body does not explicitly indicate `ok === false`

#### FR-LEARN-010
Captured middleware context shall include:
- request path
- request method
- response status
- response key list
- request or correlation ID when available

#### FR-LEARN-011
Middleware-triggered capture shall execute asynchronously and shall not block the response.

### 3.4 Error capture

#### FR-LEARN-012
The module shall support capture of error events with message, code, trimmed stack, and contextual metadata.

## 4. Security requirements

#### SEC-001
Learning-capture failures shall not interrupt normal request processing.

#### SEC-002
The module shall keep error capture bounded by truncating stack detail before logging or capture.

## 5. Operational requirements

#### OPS-001
The module shall log captured event summaries until persistent storage is implemented.

#### OPS-002
Middleware-triggered capture failures shall be logged.

#### OPS-003
The module shall export the learning event type catalog for reuse.

## 6. Reliability requirements

#### REL-001
Event capture shall degrade gracefully when storage or logging fails.

#### REL-002
Response flow shall not wait on learning capture completion.

#### REL-003
Only successful application responses shall be automatically captured by the middleware wrapper.

## 7. Non-functional requirements

#### NFR-ML-001
The module should preserve structured event shape for future ML pipeline ingestion.

#### NFR-PERF-001
Capture should remain asynchronous and low-overhead.

#### NFR-OBS-001
Missing user attribution should remain visible rather than silently hidden.

## 8. Acceptance criteria

The module is compliant if all of the following are true:
- events receive UUIDs and timestamps
- successful responses can trigger asynchronous learning capture
- missing user IDs are logged as a bug condition rather than anonymized silently
- capture failures do not break request handling
- error capture records message, code, stack excerpt, and context
```
