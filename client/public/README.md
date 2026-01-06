> **Last Verified:** 2026-01-06

# Client Public (`client/public/`)

Static assets for the React client application.

## Purpose

Files here are:
- Copied directly to the build output
- Served at the root URL path
- Not processed by Vite bundler

## Files

| File | Purpose |
|------|---------|
| `robots.txt` | Search engine directives |

## Usage

Reference files using absolute paths from root:
```html
<link rel="stylesheet" href="/some-file.css" />
```

## Notes

- Keep minimal - prefer importing assets in React components
- Large files impact initial load time
