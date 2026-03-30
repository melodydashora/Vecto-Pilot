# AI Router (`server/lib/ai/router/`)

## Purpose

Provides advanced routing logic for AI model calls, including hedging (concurrent requests), fallback, and circuit breaking.

## Components

| File | Purpose |
|------|---------|
| `hedged-router.js` | Main router class. Executes requests across multiple providers. |
| `concurrency-gate.js` | Limits concurrent requests per provider to prevent rate limiting. |
| `error-classifier.js` | Classifies errors to determine if circuit breaker should trip. |

## Usage

The router is integrated into `server/lib/ai/adapters/index.js`.

```javascript
import HedgedRouter from "./hedged-router.js";

const router = new HedgedRouter({
  adapters: new Map([ ... ])
});

// Execute request with primary and fallback providers
const result = await router.execute(request, {
  providers: ['openai', 'anthropic'] // Will race both
});
```

## Hedging Logic

1. **Race:** If multiple providers are passed, they are executed concurrently.
2. **First Success:** The first provider to return a successful response wins.
3. **Cancellation:** Pending requests to other providers are aborted.
4. **Circuit Breaking:** If a provider fails repeatedly, it is temporarily removed from the pool.

## Configuration

Default settings in `hedged-router.js`:
- `timeout`: 8000ms (default race timeout)
- `circuitThreshold`: 5 failures
- `circuitResetMs`: 60000ms (1 minute)
