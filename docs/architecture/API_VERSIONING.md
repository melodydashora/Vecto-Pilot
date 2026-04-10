# API Versioning Strategy

**Last Updated:** 2026-02-10

This document outlines the versioning strategy for the Vecto Co-Pilot API.

## 1. Current State (v1 - Implicit)

The current API is **implicit v1**.
- **Base URL:** `/api/*`
- **Versioning:** None. Breaking changes are deployed directly.
- **Client Handling:** The frontend is deployed synchronously with the backend (Monorepo), mitigating most breaking change risks during development.

## 2. Future Strategy (Explicit Versioning)

As the platform opens to third-party integrations (Level 4 Architecture), explicit versioning is required.

### Proposal: URI Path Versioning
We will adopt **URI Path Versioning** for clarity and cacheability.

- **Format:** `/api/v{major}/{resource}`
- **Example:**
    - Current: `GET /api/briefing/events`
    - Future: `GET /api/v1/briefing/events`

### Guidelines
1.  **Breaking Changes:** Require a Major Version increment (v1 -> v2).
    - Removing a field.
    - Changing a field's type.
    - Adding a required parameter.
2.  **Non-Breaking Changes:** Can be added to existing version.
    - Adding an optional field.
    - Adding a new endpoint.
3.  **Deprecation Policy:**
    - Mark endpoints as `@deprecated` in documentation.
    - Add `Deprecation` header to responses.
    - Maintain support for N-1 major versions for 6 months.

## 3. Database Schema Versioning

- **Tool:** Drizzle Kit.
- **Workflow:** Migration files (`migrations/YYYYMMDD_name.sql`) track all schema changes.
- **Rollback:** Down migrations are currently manual.
- **Validation:** `validateEventsHard.js` uses `VALIDATION_SCHEMA_VERSION` constant to handle data evolution (e.g., ensuring legacy rows are re-validated on read if needed).
