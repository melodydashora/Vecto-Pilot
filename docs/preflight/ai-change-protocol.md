# Pre-flight: AI Change Protocol

> **Created:** 2026-01-06 (Audit Remediation P2-E)
> **Purpose:** Prevent regressions in AI code paths

## Required Checks Before Any AI-Related Change

### 1. NO FALLBACKS Check

**Rule:** Never use fallback values for location/market data.

```bash
# CI Check: Grep for fallback patterns
grep -rn "|| 'America/" server/ client/
grep -rn "|| 'Dallas'" server/ client/
grep -rn "|| 'TX'" server/ client/
grep -rn "|| 'USA'" server/ client/
```

**If found:** Return error, don't guess. Missing data = bug upstream.

```javascript
// WRONG
const tz = snapshot?.timezone || 'America/Chicago';

// CORRECT
if (!snapshot?.timezone) {
  return res.status(400).json({ error: 'TIMEZONE_REQUIRED' });
}
const tz = snapshot.timezone;
```

---

### 2. Adapter Pattern Check

**Rule:** All AI API calls MUST go through the adapter.

```bash
# CI Check: Direct API imports should only be in adapter files
grep -rn "from '@anthropic-ai/sdk'" server/ --include="*.js" | grep -v "adapters/"
grep -rn "generativelanguage.googleapis.com" server/ --include="*.js" | grep -v "adapters/"
grep -rn "api.openai.com" server/ --include="*.js" | grep -v "adapters/"
```

**If found:** Refactor to use `callModel()` or `callModelStream()`.

```javascript
// WRONG - Direct API call
const response = await fetch('https://api.openai.com/v1/chat/completions', {...});

// CORRECT - Use adapter
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('ROLE_NAME', { system, user });
```

---

### 3. Model Registry Check

**Rule:** New roles MUST be registered in `model-registry.js`.

```bash
# Verify role exists before using
grep -n "ROLE_NAME" server/lib/ai/model-registry.js
```

**Required fields for new roles:**
```javascript
ROLE_NAME: {
  envKey: 'ROLE_NAME_MODEL',        // Env override
  default: 'model-id',              // Default model
  purpose: 'Description',           // What this role does
  maxTokens: 8192,                  // Token limit
  temperature: 0.7,                 // (optional for GPT-5)
  features: ['google_search'],      // (optional) enabled features
}
```

---

### 4. Coords Cache Precision Check

**Rule:** Coords cache uses 6-decimal precision.

```bash
# CI Check: Verify precision
grep -rn "toFixed(4)" server/ | grep -i coord
grep -rn "toFixed(6)" server/ | grep -i coord
```

**Standard:** `${lat.toFixed(6)}_${lng.toFixed(6)}` (~0.11m accuracy)

---

### 5. Logging Sensitivity Check

**Rule:** Never log message content, tokens, or PII.

```bash
# CI Check: Look for sensitive logging
grep -rn "console.log.*message" server/api/chat/
grep -rn "console.log.*token" client/src/
grep -rn "console.log.*system.*user" server/lib/ai/
```

**Allowed:** Log metadata only (lengths, IDs, timing).

```javascript
// WRONG
console.log(`Message: ${message.substring(0, 100)}`);

// CORRECT
console.log(`MessageLen=${message.length}`);
```

---

## Pre-Commit Checklist

Before any AI-related PR:

- [ ] No hardcoded location fallbacks (`|| 'America/*'`)
- [ ] All AI calls use adapter pattern (`callModel()`)
- [ ] New roles registered in `model-registry.js`
- [ ] Coords use 6-decimal precision
- [ ] No sensitive data in logs
- [ ] Model parameters match provider specs (see `docs/preflight/ai-models.md`)

## CI Integration

Add to `.github/workflows/ci.yml`:

```yaml
- name: AI Change Protocol Checks
  run: |
    # Check for fallbacks
    ! grep -rn "|| 'America/" server/ client/ || true

    # Check for direct API calls
    ! grep -rn "from '@anthropic-ai/sdk'" server/ --include="*.js" | grep -v "adapters/" || true
```

## Related Docs

- [AI Models Pre-flight](./ai-models.md) - Model parameters and quirks
- [Model Registry](../../server/lib/ai/model-registry.js) - Role configuration
- [Adapter Index](../../server/lib/ai/adapters/index.js) - Call patterns
