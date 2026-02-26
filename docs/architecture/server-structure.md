## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry, Autoscale detection (`CLOUD_RUN_AUTOSCALE`/`REPLIT_AUTOSCALE` disables workers, SSE, & snapshot observer), conditional SSL config, & Unified AI bootstrap |
| `strategy-generator.js` | Background strategy worker |
| `sdk-embed.js` | SDK router factory |
| `server/bootstrap/health.js` | Health endpoints configuration |
| `server/bootstrap/routes.js` | Route mounting order (Routes, SSE, Unified Capabilities) |
| `server/bootstrap/middleware.js` | Middleware configuration & Error Handling |
| `server/bootstrap/workers.js` | Background job startup (Strategy worker; Event Sync removed) |

## AI Layer (`server/lib/ai/`)

| File/Folder | Purpose |
|-------------|---------|
| `adapters/index.js` | Main dispatcher - `callModel(role, params)` |
| `adapters/anthropic-adapter.js` | Claude integration |
| `adapters/openai-adapter.js` | GPT-5.2 integration |
| `adapters/gemini-adapter.js` | Gemini integration |
| `providers/minstrategy.js` | Strategic overview (Claude Opus 4.6) |
| `providers/briefing.js` | Events, traffic, news (Gemini 3.0 Pro) |
| `providers/consolidator.js` | Tactical + daily strategy (STRATEGY_TACTICAL / STRATEGY_DAILY via callModel) |
| `models-dictionary.js` | Model configuration and roles |
| `unified-ai-capabilities.js` | Unified AI registry & monitoring |
| `coach-dal.js` | AI Coach data access layer |