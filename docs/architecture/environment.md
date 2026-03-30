# Environment & Security Configuration

**Last Updated:** 2026-02-10

This document details the environment configuration and security setup for Vecto Co-Pilot.

## 1. SSL/TLS Setup

### Production (Replit)
- **Managed by Replit:** SSL termination is handled automatically by the Replit infrastructure at the edge.
- **Protocol:** HTTPS is enforced.
- **Database:** PostgreSQL connection uses `ssl: { rejectUnauthorized: false }` to support Replit's self-signed internal certificates securely within the private network.

### Local Development
- **Mode:** HTTP (typically).
- **Tunneling:** When testing webhooks or external callbacks (e.g., Uber OAuth), use Replit's public URL (HTTPS).

## 2. Environment Validation

### Loader
- **File:** `server/config/load-env.js`
- **Function:** `loadEnvironment()`
- **Logic:**
    1.  **Replit Detection:** Checks `REPLIT_DEPLOYMENT`. If true, uses Replit Secrets directly (skips `.env` files).
    2.  **Dev Mode:** Loads `env/shared.env` then overrides with `env/{DEPLOY_MODE}.env` (e.g., `mono.env`, `split.env`).
    3.  **Contract Validation:** Enforces rules like "No background workers in Autoscale mode".

### Key Variables
| Variable | Purpose | Required |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `GEMINI_API_KEY` | Google AI Studio key | Yes |
| `OPENAI_API_KEY` | OpenAI Platform key | Yes |
| `ANTHROPIC_API_KEY` | Anthropic Console key | Yes |
| `TOMTOM_API_KEY` | Traffic data provider | Yes |
| `GOOGLE_MAPS_API_KEY` | Places, Routes, Geocoding | Yes |
| `JWT_SECRET` | Auth token signing | Yes |
| `DEPLOY_MODE` | `mono` (default), `webservice`, `worker` | No |

## 3. Security Best Practices
- **Secrets:** Never commit `.env` files. Use Replit Secrets or environment variables.
- **Sanitization:** All inputs sanitized via `zod` schemas (`server/middleware/validate.js`).
- **Headers:** `helmet` middleware strips dangerous headers and sets security policies.
