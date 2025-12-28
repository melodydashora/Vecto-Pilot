# Config

Application configuration files.

## Files

| File | Purpose |
|------|---------|
| `agent-policy.json` | AI agent behavior policies and guardrails |
| `assistant-policy.json` | Assistant mode configuration |
| `eidolon-policy.json` | Eidolon SDK configuration |
| `agent-ai-config.js` | AI model configuration (if present) |
| `models-dictionary.json` | Model name mappings (if present) |

## Usage

Configuration is loaded at server startup:

```javascript
import agentPolicy from '../config/agent-policy.json';
```

## Environment Override

Many settings can be overridden via environment variables. See `.env.example`.

## See Also

- [server/config/](../server/config/) - Server-specific configuration
- [CLAUDE.md](../CLAUDE.md) - AI assistant guidelines
