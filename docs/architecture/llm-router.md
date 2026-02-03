# LLM Router Architecture

## Overview

The LLM Router provides resilient, low-latency access to multiple LLM providers (Anthropic, OpenAI, Google) through hedged routing and circuit breaker patterns.

## Components

### 1. Hedged Router (`server/lib/ai/router/hedged-router.js`)

Fires concurrent requests to multiple providers and takes the first successful response.

**Benefits:**
- Reduced p99 latency (fastest provider wins)
- Automatic failover without retry delay
- Load distribution across providers

**Configuration:**
```javascript
const router = new HedgedRouter({
  providers: ['anthropic', 'openai', 'google'],
  timeout: 8000,  // 8 second timeout
  circuitThreshold: 5,  // Open circuit after 5 failures
  circuitResetMs: 60000,  // Reset after 1 minute
});
```

### 2. Concurrency Gate (`server/lib/ai/router/concurrency-gate.js`)

Limits concurrent requests per provider to prevent overwhelming APIs.

```javascript
const gate = new ConcurrencyGate({
  maxConcurrent: 10,  // Max 10 concurrent per provider
  queueTimeout: 30000,  // 30s queue timeout
});
```

### 3. Error Classifier (`server/lib/ai/router/error-classifier.js`)

Classifies errors to determine retry and circuit breaker behavior.

| Error Type | Should Retry | Affects Circuit |
|------------|--------------|-----------------|
| ABORTED | No | No |
| TIMEOUT | Yes | Yes |
| THROTTLED | No | Yes |
| SERVER (5xx) | Yes | Yes |
| CLIENT (4xx) | No | No |

## Router Modes by Role

| Role | Mode | Timeout | Reason |
|------|------|---------|--------|
| STRATEGY_TACTICAL | hedged | 8s | Speed for real-time UX |
| BRIEFING_TRAFFIC | hedged | 8s | Real-time data |
| BRIEFING_EVENTS | hedged | 8s | Time-sensitive |
| STRATEGY_CORE | single | 30s | Accuracy critical |
| VENUE_SCORER | single | 15s | Ranking accuracy |
| ENRICHMENT | single | 20s | Data consistency |

## Usage

### Basic Hedged Call
```javascript
import { callModelWithRouter } from './server/lib/ai/adapters/index.js';

const result = await callModelWithRouter('STRATEGY_TACTICAL', {
  system: 'You are a strategy advisor...',
  user: 'What should I do now?',
});

console.log(result.output);  // Response text
console.log(result.provider);  // Which provider responded
console.log(result.latencyMs);  // Response time
```

### Force Single Provider
```javascript
const result = await callModelWithRouter('STRATEGY_TACTICAL', {
  system: '...',
  user: '...',
}, { forceMode: 'single' });
```

### Get Metrics
```javascript
import { getRouterMetrics } from './server/lib/ai/adapters/index.js';

const metrics = getRouterMetrics();
console.log(metrics.totalCalls);
console.log(metrics.successfulCalls);
console.log(metrics.byProvider);
```

## Circuit Breaker

The circuit breaker prevents cascading failures by temporarily removing failing providers.

**States:**
1. **Closed** - Normal operation, requests flow through
2. **Open** - Provider removed after threshold failures
3. **Half-Open** - After reset time, allow one request to test

**Configuration via Environment:**
```bash
LLM_ROUTER_MODE=hedged  # single | hedged
LLM_HEDGED_TIMEOUT_MS=8000
LLM_MAX_CONCURRENT_PER_PROVIDER=10
```

## Monitoring

Check router health:
```javascript
const metrics = getRouterMetrics();

// Check circuit states
for (const [provider, state] of Object.entries(metrics.circuitStates)) {
  if (state.openUntil) {
    console.warn(`Circuit OPEN for ${provider} until ${state.openUntil}`);
  }
}

// Check concurrency
for (const [provider, stats] of Object.entries(metrics.concurrency.providers)) {
  console.log(`${provider}: ${stats.active}/${stats.capacity} active, ${stats.waiting} waiting`);
}
```

## Testing

Run router tests:
```bash
npm test -- tests/router/hedged-router.test.js
```
