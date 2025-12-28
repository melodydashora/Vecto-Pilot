# .well-known

Standard well-known URI directory (RFC 8615).

## Purpose

Contains standardized files that services expect at `/.well-known/` paths.

## Common Files

| File | Purpose |
|------|---------|
| `apple-app-site-association` | iOS app deep linking |
| `assetlinks.json` | Android app linking |
| `security.txt` | Security contact info |

## Notes

Files here are served without the `.well-known` prefix in URL.
