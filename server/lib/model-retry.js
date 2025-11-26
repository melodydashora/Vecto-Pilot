// server/lib/model-retry.js
// Model-agnostic retry logic with exponential backoff
import { callModel } from './adapters/index.js';

export async function callGPT5WithBudget(payload, { timeoutMs = 45000, maxRetries = 6 } = {}) {
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const budgetRemaining = deadline - Date.now();
    
    console.log(`[retry] attempt=${attempt} budget_remaining=${budgetRemaining}ms`);
    
    if (budgetRemaining <= 0) {
      console.log(`[retry] attempt=${attempt} result=error reason=budget_exceeded`);
      return {
        ok: false,
        code: 'TIMEOUT',
        reason: 'Budget exceeded',
        ms: Date.now() - startTime,
        attempt
      };
    }

    const attemptStart = Date.now();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), budgetRemaining);

    try {
      const response = await callGPT5({
        ...payload,
        abortSignal: abortController.signal
      });
      
      clearTimeout(timeoutId);
      const ms = Date.now() - attemptStart;
      
      console.log(`[retry] attempt=${attempt} result=success ms=${ms} tokens=${response.total_tokens}`);
      
      return {
        ok: true,
        text: response.text,
        ms,
        tokens: response.total_tokens || 0,
        reasoning_tokens: response.reasoning_tokens || 0,
        prompt_tokens: response.prompt_tokens || 0,
        completion_tokens: response.completion_tokens || 0,
        attempt
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const ms = Date.now() - attemptStart;
      
      // Check if error is transient (should retry)
      const errorMsg = err.message || String(err);
      const isTransient = 
        errorMsg.includes('429') ||
        errorMsg.includes('502') ||
        errorMsg.includes('503') ||
        errorMsg.includes('504') ||
        errorMsg.includes('Gateway') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('aborted');

      if (isTransient && attempt < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(1.5, attempt - 1), 3000);
        console.log(`[retry] attempt=${attempt} result=error reason=timeout ms=${ms}`);
        console.log(`[retry] retrying after ${backoff}ms backoff (network error)`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      console.log(`[retry] attempt=${attempt} result=error reason=${errorMsg.substring(0, 50)} ms=${ms}`);
      return {
        ok: false,
        code: err.status || 500,
        reason: errorMsg,
        ms: Date.now() - startTime,
        attempt
      };
    }
  }

  return {
    ok: false,
    code: 'MAX_RETRIES',
    reason: 'Maximum retries exceeded',
    ms: Date.now() - startTime,
    attempt
  };
}
