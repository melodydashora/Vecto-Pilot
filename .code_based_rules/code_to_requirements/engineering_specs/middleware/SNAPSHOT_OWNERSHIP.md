# Engineering Specification: Snapshot Ownership Middleware

## 1. Scope

This specification defines the requirements for enforcing authenticated ownership of snapshot resources before downstream access is granted.

## 2. System purpose

The snapshot-ownership middleware shall:
- require an authenticated user context
- require a target snapshot identifier
- load the snapshot from persistence
- reject missing, orphaned, or foreign-owned snapshots
- attach the verified snapshot to the request for downstream use

---

## 3. Functional requirements

#### FR-SNAP-001
The middleware shall require a `snapshotId` route parameter.

#### FR-SNAP-002
If `snapshotId` is missing, the middleware shall return HTTP `400`.

#### FR-SNAP-003
The middleware shall require `req.auth.userId` to be present.

#### FR-SNAP-004
If authentication context is missing, the middleware shall return HTTP `401`.

#### FR-SNAP-005
The middleware shall load the snapshot record from the database by `snapshot_id`.

#### FR-SNAP-006
If the snapshot does not exist, the middleware shall return HTTP `404`.

#### FR-SNAP-007
If the snapshot exists but has a null `user_id`, the middleware shall reject it as orphaned data using HTTP `404`.

#### FR-SNAP-008
If the snapshot owner does not match the authenticated user, the middleware shall return HTTP `404`.

#### FR-SNAP-009
If ownership checks succeed, the middleware shall attach the snapshot record to `req.snapshot` and call `next()`.

## 4. Security requirements

#### SEC-001
The middleware shall enforce strict ownership equality between `snapshot.user_id` and `req.auth.userId`.

#### SEC-002
Null-owned snapshots shall not be treated as accessible.

#### SEC-003
Ownership failures shall return `404` rather than `403` to reduce resource enumeration risk.

## 5. Operational requirements

#### OPS-001
The middleware shall be used after authentication middleware has populated `req.auth`.

#### OPS-002
Failures shall be logged with snapshot or user context when available.

## 6. Reliability requirements

#### REL-001
Database or unexpected runtime errors shall return HTTP `500`.

#### REL-002
Successful ownership checks shall produce a stable attached snapshot object for downstream handlers.

## 7. Non-functional requirements

#### NFR-SEC-001
The middleware shall prioritize strict access control over permissive fallback.

#### NFR-MAINT-001
The implementation shall remain narrowly focused on ownership verification and request attachment.

## 8. Acceptance criteria

The middleware is compliant if all of the following are true:
- missing `snapshotId` returns `400`
- missing auth context returns `401`
- missing, orphaned, or foreign-owned snapshots return `404`
- verified snapshots are attached to `req.snapshot`
```