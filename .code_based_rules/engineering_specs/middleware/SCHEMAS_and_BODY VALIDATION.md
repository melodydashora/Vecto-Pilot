# Engineering Specification: Validation Schemas and Body Validation Middleware (`validation.js`)

## 1. Scope

This specification defines the requirements for common Zod schemas and a body-validation middleware that parses request bodies into `req.validatedBody`.

## 2. System purpose

The module shall:
- provide reusable common schemas for UUIDs, actions, feedback, location, and snapshot payloads
- validate request bodies with strict parsing behavior
- attach parsed request data to a dedicated validated field
- return stable `400` responses for schema failures

---

## 3. Functional requirements

### 3.1 Schema catalog

#### FR-ZOD-001
The module shall export a schema catalog.

#### FR-ZOD-002
The schema catalog shall include reusable definitions for:
- UUID
- action payloads
- feedback payloads
- location payloads
- snapshot payloads

#### FR-ZOD-003
The action schema shall accept both `action` and `action_type` as nullable or undefined fields.

#### FR-ZOD-004
The action schema shall constrain enumerated action values to the defined supported action set.

#### FR-ZOD-005
The feedback schema shall validate venue, snapshot, rating, comment, and feedback type fields.

#### FR-ZOD-006
The location schema shall validate latitude, longitude, and optional accuracy.

#### FR-ZOD-007
The snapshot schema shall validate user coordinates and optional timezone or weather payloads.

### 3.2 Middleware behavior

#### FR-ZOD-008
The module shall export a validation middleware factory that parses `req.body` using the supplied schema.

#### FR-ZOD-009
Successful body validation shall assign parsed output to `req.validatedBody`.

#### FR-ZOD-010
Successful body validation shall call `next()`.

#### FR-ZOD-011
If schema parsing raises a `ZodError`, the middleware shall return HTTP `400`.

#### FR-ZOD-012
Validation failure responses shall include:
- `ok: false`
- `error: "VALIDATION_ERROR"`
- `message: "Invalid request data"`
- `details`

#### FR-ZOD-013
Each validation detail entry shall include:
- `field`
- `message`

#### FR-ZOD-014
Non-Zod errors shall be delegated to the next error handler.

## 4. Security requirements

#### SEC-001
Malformed request bodies shall not reach downstream handlers as trusted input.

#### SEC-002
Schema-enforced bounds and enums shall be applied before request processing continues.

## 5. Operational requirements

#### OPS-001
Validation failures shall be logged with a summarized field-level error description.

#### OPS-002
The module shall support Zod error arrays exposed via either `errors` or `issues`.

## 6. Reliability requirements

#### REL-001
Zod validation failures shall return stable `400` responses without throwing uncaught exceptions.

#### REL-002
Non-Zod errors shall continue through the application's general error pipeline.

## 7. Non-functional requirements

#### NFR-MAINT-001
The module shall centralize common request schemas for reuse across route handlers.

#### NFR-USE-001
Validation failure responses should remain field-specific and client-usable.

#### NFR-SEC-001
Validated request bodies should be separated from raw input through `req.validatedBody`.

## 8. Acceptance criteria

The module is compliant if all of the following are true:
- common schemas are exported for UUID, action, feedback, location, and snapshot payloads
- successful validation stores parsed data in `req.validatedBody`
- Zod validation failures return `400` with field details
- non-Zod failures are passed to the next error handler
```
