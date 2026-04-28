# Engineering Specification: Rate Limit Middleware

## 1. Scope

This specification defines the requirements for route-level and global rate-limiting middleware, including expensive-endpoint limits, chat limits, translation-specific limits, global API limits, and health-route limits.

## 2. System purpose

The rate-limit middleware shall:
- protect high-cost endpoints from overuse
- provide stricter limits for chat-like traffic
- support higher-volume translation traffic with a custom key strategy
- provide a global default limit for API traffic
- permit higher-rate health and monitoring access

---

## 3. Functional requirements

### 3.1 Expensive endpoint limiter

#### FR-RL-001
The expensive-endpoint limiter shall enforce a 1-minute window.

#### FR-RL-002
The expensive-endpoint limiter shall allow a maximum of 5 requests per minute.

#### FR-RL-003
Health and auth routes shall bypass the expensive-endpoint limiter.

### 3.2 Chat limiter

#### FR-RL-004
The chat limiter shall enforce a 1-minute window.

#### FR-RL-005
The chat limiter shall allow a maximum of 3 requests per minute.

#### FR-RL-006
Health routes shall bypass the chat limiter.

### 3.3 Translation limiter

#### FR-RL-007
The translation limiter shall enforce a 1-minute window.

#### FR-RL-008
The translation limiter shall allow a maximum of 30 requests per minute.

#### FR-RL-009
The translation limiter shall generate keys using client IP plus request `device_id`.

#### FR-RL-010
The translation limiter shall disable IP fallback validation used by the underlying library.

### 3.4 Global API limiter

#### FR-RL-011
The global API limiter shall enforce a 1-minute window.

#### FR-RL-012
The global API limiter shall allow a maximum of 100 requests per minute per IP.

#### FR-RL-013
Health and diagnostic paths shall bypass the global API limiter.

### 3.5 Health limiter

#### FR-RL-014
The health limiter shall enforce a 1-minute window.

#### FR-RL-015
The health limiter shall allow a maximum of 200 requests per minute.

### 3.6 Response behavior

#### FR-RL-016
Each limiter shall return a structured JSON message when the limit is exceeded.

#### FR-RL-017
Standard rate-limit headers shall be enabled.

## 4. Security requirements

#### SEC-001
High-cost or abuse-prone routes shall be protected by request throttling.

#### SEC-002
Global API traffic shall have a default rate limit unless explicitly bypassed.

#### SEC-003
Health and diagnostic routes may receive dedicated higher thresholds rather than being entirely unbounded.

## 5. Operational requirements

#### OPS-001
The module shall export discrete limiters for targeted route assignment.

#### OPS-002
Translation traffic shall support a more generous limit suited to conversational usage.

#### OPS-003
Bypass rules shall be path-based and explicit.

## 6. Reliability requirements

#### REL-001
Each limiter shall enforce stable per-window request caps.

#### REL-002
Key-generation behavior for translation traffic shall remain deterministic for the same IP and device identifier.

## 7. Non-functional requirements

#### NFR-SEC-001
The module shall balance abuse prevention with route-specific usability.

#### NFR-MAINT-001
The limiter set should remain modular so routes can choose stricter or broader policies.

#### NFR-USE-001
Exceeded-limit responses should remain machine-readable and user-facing.

## 8. Acceptance criteria

The module is compliant if all of the following are true:
- expensive endpoints are limited to 5/minute
- chat endpoints are limited to 3/minute
- translation endpoints are limited to 30/minute using IP-plus-device keying
- global API traffic is limited to 100/minute except approved health or diagnostic paths
- health routes can be limited separately at 200/minute
```