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