# Agent Override LLM (`server/agent/agent-override-llm.js`)

This module configures the primary AI agent interface, currently unified on **Claude Opus 4.6** via Anthropic.

## Configuration

The system is configured as a single-provider instance to match Eidolon's ultra-enhanced parameters.

- **Provider**: Anthropic
- **Model**: `claude-opus-4-6` (Default). Configurable via `AGENT_OVERRIDE_CLAUDE_MODEL` or `AGENT_MODEL`.
- **API Key**: `AGENT_OVERRIDE_API_KEY_C` or `ANTHROPIC_API_KEY`

### Tuning Parameters

| Parameter | Environment Variable | Default |
|-----------|---------------------|---------|
| Max Tokens | `CLAUDE_MAX_TOKENS` / `AGENT_MAX_TOKENS` | `200000` |
| Temperature | `CLAUDE_TEMPERATURE` / `AGENT_TEMPERATURE` | `1.0` |

## Self-Healing & Reliability

The agent implements a circuit breaker pattern to manage API stability:

- **Threshold**: 3 consecutive failures trigger the circuit breaker.
- **Cooldown**: 60 seconds (60,000ms) lockout period.
- **Recovery**: Automatic reset on the next successful call after cooldown.
- **Health Check**: `getAgentHealth()` exposes circuit status and failure metrics.

---

# Config Manager (`server/agent/config-manager.js`)

This module manages configuration file access, environment variable updates, and file backups. It enforces a strict allowlist of files to ensure security.

## Allowed Configuration Files

The manager restricts access to specific configuration files, including:
- **Environment**: `.env`, `.env.local`, `.env.example`, etc.
- **Build & Bundler**: `package.json`, `vite.config.*`, `drizzle.config.*`, `tailwind.config.*`, `postcss.config.*`.
- **TypeScript & Linting**: `tsconfig.*`, `eslint.config.js`, `.prettierrc.*`.
- **Infrastructure**: `Dockerfile`, `docker-compose.yml`, `replit.nix`.
- **Monorepo & Testing**: `nx.json`, `turbo.json`, `lerna.json`, `jest.config.js`, `vitest.config.ts`, `playwright.config.ts`.
- **Server & App Config**: `gateway-server.js`, `agent-server.js`, `index.js`, `config/assistant-policy.json`, `server/config/assistant-policy.json`.
- **Documentation**: `README.md`, `ARCHITECTURE.md`, `ISSUES.md`, `replit.md`.

## API Reference

### `readConfigFile(filename)`
Reads the content of an allowed configuration file.
- **Returns**: Object containing `ok` status, `content`, and absolute `path`. Returns `{ ok: false, error: "file_not_found" }` if the file is missing.
- **Throws**: Error if the file is not in the allowed list.

### `updateEnvFile(updates)`
Updates the `.env` file with new values.
- **Features**: Preserves existing comments and formatting. Appends new keys if they do not exist.
- **Returns**: Object with `updated` keys list.

### `getEnvValue(key)`
Retrieves a specific value from the `.env` file.
- **Returns**: The value string (with quotes removed) or `null` if not found.

### `listConfigFiles()`
Scans for all allowed configuration files.
- **Returns**: List of file objects containing `size`, `modified` date, and `exists` status.

### `backupConfigFile(filename)`
Creates a backup of the specified file.
- **Format**: `<filename>.backup-<timestamp>-<random_suffix>`