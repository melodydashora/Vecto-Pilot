> **Last Verified:** 2026-01-06

# .well-known

Standard well-known URI directory (RFC 8615).

## Purpose

Contains standardized files that services expect at `/.well-known/` paths.

## Files

| File | Purpose |
|------|---------|
| `jwks.json` | JSON Web Key Set for JWT verification |

## Notes

Files here are served at `/.well-known/` paths. For example:
- `jwks.json` is served at `/.well-known/jwks.json`
