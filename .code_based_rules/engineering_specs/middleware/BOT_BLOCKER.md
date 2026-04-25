# Engineering Specification: Bot Blocker Middleware

## 1. Scope

This specification defines the functional, operational, security, reliability, and non-functional requirements for the bot-blocking middleware, including user-agent screening, suspicious-path blocking, and route-level exceptions for health, hooks, memory, and internal probe paths.

## 2. System purpose

The bot blocker shall:
- block known crawlers, scrapers, scanners, and headless automation clients
- deny common probe paths associated with enumeration or exploitation attempts
- allow explicitly approved public or platform paths to bypass bot checks
- support a lighter API-only blocking mode for selective use

---

## 3. Functional requirements

### 3.1 Detection behavior

#### FR-BOT-001
The middleware shall maintain a list of case-insensitive bot user-agent patterns.

#### FR-BOT-002
The middleware shall treat missing user-agent values as suspicious bot traffic.

#### FR-BOT-003
The middleware shall maintain a list of suspicious paths commonly probed by bots or scanners.

#### FR-BOT-004
Suspicious-path matching shall be prefix-based and case-insensitive.

### 3.2 Standard bot-blocking flow

#### FR-BOT-005
The standard middleware shall inspect the request path and user-agent before allowing the request to continue.

#### FR-BOT-006
Requests to suspicious paths shall be rejected immediately with HTTP `404`.

#### FR-BOT-007
Requests matching known bot user-agent patterns shall be rejected with HTTP `403` and a JSON denial payload.

#### FR-BOT-008
Allowed requests shall continue to downstream middleware via `next()`.

### 3.3 Approved bypasses

#### FR-BOT-009
The middleware shall allow requests to `/robots.txt`.

#### FR-BOT-010
The middleware shall allow health-check routes including `/health` and `/api/health`.

#### FR-BOT-011
The middleware shall allow internal preview or reachability paths beginning with `/__repl`.

#### FR-BOT-012
The middleware shall allow public automation-hook paths beginning with `/api/hooks`.

#### FR-BOT-013
The middleware shall allow internal memory API paths beginning with `/api/memory`.

### 3.4 API-only mode

#### FR-BOT-014
The API-only variant shall apply bot checks only to routes whose path starts with `/api`.

#### FR-BOT-015
Non-API routes shall bypass the API-only variant.

#### FR-BOT-016
Bot traffic detected by the API-only variant shall be rejected with HTTP `403` and a JSON denial payload.

## 4. Security requirements

#### SEC-001
Known automated clients, crawlers, scanners, and suspicious headless tooling shall be denied access by default.

#### SEC-002
Paths commonly associated with exploitation or reconnaissance shall be rejected without exposing resource existence.

#### SEC-003
Approved public or internal automation paths shall be explicitly allowlisted rather than implicitly bypassed.

## 5. Operational requirements

#### OPS-001
The middleware shall log suspicious-path blocks with request path and client IP.

#### OPS-002
The middleware shall log blocked bot traffic with user-agent snippet, client IP, and path.

#### OPS-003
The middleware shall provide both full-site and API-only deployment options.

## 6. Reliability requirements

#### REL-001
Bot detection shall fail conservatively for missing user-agent values.

#### REL-002
Requests matching explicit bypass rules shall continue without user-agent enforcement.

## 7. Non-functional requirements

#### NFR-SEC-001
The middleware shall prefer denial of suspicious automated access over permissive fallback.

#### NFR-MAINT-001
Bot patterns and suspicious-path patterns should remain centrally maintainable lists.

#### NFR-OBS-001
Block decisions should be visible in logs for diagnosis and tuning.

## 8. Explicit prohibitions

The implementation shall not:
- allow known bot user agents by default
- block explicitly approved health, hook, memory, or internal reachability paths
- expose suspicious-path hits as successful or normal application routes

## 9. Acceptance criteria

The middleware is compliant if all of the following are true:
- suspicious paths are rejected with `404`
- known bot user agents are rejected with `403`
- `/robots.txt`, health endpoints, `/__repl*`, `/api/hooks*`, and `/api/memory*` are allowed
- API-only mode only enforces on `/api*` routes
```