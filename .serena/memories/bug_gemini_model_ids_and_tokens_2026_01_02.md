# Bug Fix: Gemini Model IDs and Token Budget

**Date:** January 2, 2026
**Status:** Fixed
**Tags:** gemini, bug, api, tokens

## Issue 1: Model ID 404 Errors

**Symptom:**
```
[404 Not Found] models/gemini-3-flash is not found for API version v1beta
```

**Root Cause:**
Gemini 3 model IDs require `-preview` suffix. The base names (`gemini-3-pro`, `gemini-3-flash`) are not valid.

**Fix:**
```javascript
// WRONG
model: "gemini-3-pro"     // 404 error
model: "gemini-3-flash"   // 404 error

// CORRECT
model: "gemini-3-pro-preview"
model: "gemini-3-flash-preview"
```

**Files Fixed:**
- `server/lib/briefing/briefing-service.js` line 457
- `server/lib/strategy/strategy-generator-parallel.js` line 214

## Issue 2: MAX_TOKENS with 0 Parts

**Symptom:**
```
Empty Gemini response (finishReason: MAX_TOKENS, parts: 0)
```

**Root Cause:**
When `thinkingLevel: "HIGH"` is enabled, the thinking process consumes tokens from `maxOutputTokens`. With only 2048 tokens, thinking used ALL tokens, leaving 0 for the actual response.

**Fix:**
```javascript
// WRONG - thinking consumes all tokens
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 2048 }

// CORRECT - enough room for thinking + response
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 8192 }
```

**Token Budget Guidelines:**
| thinkingLevel | Min maxOutputTokens |
|---------------|---------------------|
| LOW | 2048 |
| MEDIUM | 4096 |
| HIGH | 8192+ |

**Files Fixed:**
- `server/lib/briefing/briefing-service.js` line 2014 (news: 2048 → 8192)
- `server/lib/briefing/briefing-service.js` line 1324 (TBD: 2048 → 8192)
- `server/lib/briefing/briefing-service.js` line 1372 (weather: 1000 → 4096)

## Documentation Updated

- `MODEL.md` - Token Budget for Thinking section
- `docs/preflight/ai-models.md` - Gemini 3 Token Budget section
- `server/api/briefing/README.md` - Gemini Configuration Notes
- `LESSONS_LEARNED.md` - Added token budget examples
