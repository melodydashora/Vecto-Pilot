## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry & Unified AI bootstrap |
| `agent-ai-config.js` | AI configuration and limits |
| `strategy-generator.js` | Background strategy worker |
| `sdk-embed.js` | SDK router factory |
| `server/bootstrap/health.js` | Health endpoints configuration |
| `server/bootstrap/routes.js` | Route mounting order |
| `server/bootstrap/middleware.js` | Middleware configuration |
| `server/bootstrap/workers.js` | Background job startup (Strategy) |

## AI Layer (`server/lib/ai/`)

| File/Folder | Purpose |
|-------------|---------|
| `adapters/index.js` | Main dispatcher - `callModel(role, params)` |
| `adapters/anthropic-adapter.js` | Claude integration |
| `adapters/openai-adapter.js` | GPT-5.2 integration |
| `adapters/gemini-adapter.js` | Gemini integration |
| `providers/minstrategy.js` | Strategic overview (Claude Opus 4.6) |
| `providers/briefing.js` | Events, traffic, news (Gemini 3.0 Pro) |
| `providers/consolidator.js` | Final strategy (GPT-5.2) |
| `models-dictionary.js` | Model configuration and roles |
| `unified-ai-capabilities.js` | Unified AI registry & monitoring |
| `coach-dal.js` | AI Coach data access layer |