# Client (`client/`)

## Purpose

React frontend application built with Vite, TypeScript, TailwindCSS, and React Router.

## Structure

| Path | Purpose |
|------|---------|
| `src/` | Source code (see `src/README.md`) |
| `src/routes.tsx` | React Router configuration |
| `src/layouts/` | Layout components (CoPilotLayout) |
| `src/pages/co-pilot/` | 7 route-based page components |
| `src/contexts/` | React contexts (location, co-pilot) |
| `public/` | Static assets |
| `dist/` | Build output |
| `index.html` | Entry HTML |

## Configuration

| File | Purpose |
|------|---------|
| `vite.config.ts` | Vite bundler configuration |
| `tsconfig.json` | TypeScript configuration |
| `postcss.config.js` | PostCSS/TailwindCSS configuration |

## Commands

```bash
# Development (from project root)
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## Source Code

See [src/README.md](src/README.md) for frontend architecture and components.
