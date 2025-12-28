# Client Public

Static assets for the React client application.

## Purpose

Files here are:
- Copied directly to the build output
- Served at the root URL path
- Not processed by Vite bundler

## Common Files

| File | Purpose |
|------|---------|
| `favicon.ico` | Browser tab icon |
| `manifest.json` | PWA manifest |
| `icons/` | App icons for various sizes |

## Usage

Reference files using absolute paths from root:
```html
<link rel="icon" href="/favicon.ico" />
```

## Notes

- Keep minimal - prefer importing assets in React components
- Large files impact initial load time
