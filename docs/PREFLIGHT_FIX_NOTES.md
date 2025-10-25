# Preflight Test Fix Required: OpenAI GPT-5 Token Budget Issue

## Issue Found
**Date:** 2025-10-09  
**Test Location:** Step 2 - API Keys Wired to Right Services  
**Status:** ❌ FAILING with current parameters

## Root Cause
The OpenAI GPT-5 test command uses incompatible parameters:

```bash
curl -s https://api.openai.com/v1/chat/completions \
  -H "authorization: Bearer $OPENAI_API_KEY" -H "content-type: application/json" \
  -d '{"model":"gpt-5","messages":[{"role":"user","content":"ping"}],"max_completion_tokens":16,"reasoning_effort":"minimal"}'
```

**Error returned:**
```json
{
  "error": {
    "message": "Could not finish the message because max_tokens or model output limit was reached.",
    "type": "invalid_request_error"
  }
}
```

## Technical Explanation
GPT-5's reasoning architecture splits `max_completion_tokens` between:
- **Reasoning tokens** (internal model computation)
- **Completion tokens** (actual response)

Even with `reasoning_effort: "minimal"`, the model consumes tokens for internal reasoning **before** generating output. With only **16 tokens**, the budget is exhausted on reasoning, leaving **zero tokens** for the response.

## Research Sources
- Perplexity Research Query: "OpenAI GPT-5 reasoning_effort parameter and token consumption"
- Key Finding: "Higher reasoning_effort values cause the model to spend more tokens on internal reasoning, which can significantly reduce the number of tokens available for the actual output"
- Valid reasoning_effort values: "minimal", "low", "medium" (default), "high"

## Solution

**Option 1: Increase Token Budget (Recommended)**
```bash
curl -s https://api.openai.com/v1/chat/completions \
  -H "authorization: Bearer $OPENAI_API_KEY" -H "content-type: application/json" \
  -d '{"model":"gpt-5","messages":[{"role":"user","content":"ping"}],"max_completion_tokens":64,"reasoning_effort":"minimal"}' \
| jq -r '.model' | grep -q '^gpt-5-'
```
✅ **Verified working** - Returns `gpt-5-2025-08-07`

**Option 2: Remove reasoning_effort Parameter**
```bash
curl -s https://api.openai.com/v1/chat/completions \
  -H "authorization: Bearer $OPENAI_API_KEY" -H "content-type: application/json" \
  -d '{"model":"gpt-5","messages":[{"role":"user","content":"ping"}],"max_completion_tokens":16}' \
| jq -r '.model' | grep -q '^gpt-5-'
```
✅ **Verified working** - Model verification doesn't require reasoning_effort

## Recommendation
Update the preflight test to use **Option 1** (64 tokens with reasoning_effort) to:
1. Verify the model ID correctly
2. Test reasoning_effort parameter compatibility
3. Ensure sufficient token budget for GPT-5's architecture

## Verification Status
- ✅ API key is valid
- ✅ GPT-5 model accessible
- ✅ Corrected test passes
- ❌ Original test fails due to token budget limitation

**Action Required:** Update preflight script line ~18 to use `max_completion_tokens: 64` instead of `16`
