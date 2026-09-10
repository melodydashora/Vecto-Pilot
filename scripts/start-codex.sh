#!/usr/bin/env bash
# Melody's Replit entry point. Credentials stay in the existing environment.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"

if ! command -v codex >/dev/null 2>&1; then
  printf '%s\n' 'Codex is not installed. See https://developers.openai.com/codex/cli/' >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' 'DATABASE_URL is unavailable. Open the VectoPilot Replit shell with its existing secrets.' >&2
  exit 1
fi
if [[ ! -f mcp-server.js || ! -d node_modules/@modelcontextprotocol/sdk ]]; then
  printf '%s\n' 'The existing VectoPilot MCP server and its dependencies must be present before boot.' >&2
  exit 1
fi

# Supply only the environment variable name; never persist its secret value.
# CLI overrides keep this launcher independent of machine-specific user config.
codex_args=(
  --cd "$repo_root"
  --sandbox danger-full-access
  --ask-for-approval never
  --no-alt-screen
  -c 'mcp_servers.vecto-pilot.command="node"'
  -c 'mcp_servers.vecto-pilot.args=["mcp-server.js","--stdio"]'
  -c 'mcp_servers.vecto-pilot.env_vars=["DATABASE_URL"]'
  -c 'mcp_servers.vecto-pilot.startup_timeout_sec=30'
)

if (( $# )); then
  exec codex "${codex_args[@]}" "$@"
fi

exec codex "${codex_args[@]}" 'Boot VectoPilot using AGENTS.md, CLAUDE.md, AI_PARTNERSHIP_AGREEMENT.md, and the latest relevant handoff. Inspect the live branch, HEAD, and working tree. Call the vecto-pilot MCP boot_context, then expand relevant memory, todos, lessons, definitions, and app rules. Read any existing .config/astra-vecto-coordination message and reply files; do not claim Claude acknowledged a message unless there is evidence. Report which live sources were actually read and the current task ownership. This first turn is startup verification: preserve concurrent work and make no application or database changes. Melody wants subsequent CLI work to improve VectoPilot alongside Claude; shortcuts remain with Melody and Claude.'
