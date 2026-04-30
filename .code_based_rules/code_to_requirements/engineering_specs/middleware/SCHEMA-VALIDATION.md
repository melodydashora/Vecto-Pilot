# Engineering Specification: Schema Validation Middleware (`validate.js`)

## 1. Scope

This specification defines the requirements for schema-based validation of request body, query, or route parameters using safe-parse semantics and formatted field errors.

## 2. System purpose

The validation middleware shall:
- validate request data from a selected request source
- return structured validation errors for invalid input
- replace request data with validated or transformed output on success
- provide convenience wrappers for body, query, and params validation

---

## 3. Functional requirements

#### FR-VAL-001
The module shall export a validation middleware factory accepting a schema and a source selector.

#### FR-VAL-002
Supported validation sources shall include:
- `body`
- `query`
- `params`

#### FR-VAL-003
If the selected request source is absent, the middleware shall return HTTP `400` with `validation_failed`.

#### FR-VAL-004
The middleware shall validate the selected source using `safeParse()`.

#### FR-VAL-005
If validation fails, the middleware shall format the top-level error message and return HTTP `400`.

#### FR-VAL-006
Validation failure responses shall include:
- `error: "validation_failed"`
- a user-facing message
- `field_errors`

#### FR-VAL-007
Each field error shall include:
- `field`
- `message`
- `code`

#### FR-VAL-008
If validation succeeds, the middleware shall replace `req[source]` with the validated or transformed data.

#### FR-VAL-009
The module shall export convenience wrappers for body, query, and params validation.

## 4. Security requirements

#### SEC-001
Invalid request input shall not proceed to downstream handlers.

#### SEC-002
Only schema-validated or schema-transformed request data shall continue downstream.

## 5. Operational requirements

#### OPS-001
Validation failures shall be logged with request method, request path, source, and issue details.

#### OPS-002
The middleware shall support Zod issue arrays from multiple library versions.

## 6. Reliability requirements

#### REL-001
Validation failures shall return deterministic `400` responses rather than throwing.

#### REL-002
Successful validation shall always call `next()` after replacing the request data.

## 7. Non-functional requirements

#### NFR-USE-001
Validation errors should remain readable and field-specific for clients.

#### NFR-MAINT-001
The module shall support reuse through a single generic factory plus source-specific wrappers.

## 8. Acceptance criteria

The middleware is compliant if all of the following are true:
- body, query, and params can each be validated
- missing selected input returns `400`
- invalid input returns structured field errors
- validated data replaces the original request source
```