// server/lib/transient-retry.js
// Transient-aware retry logic for LLM calls with exponential backoff

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransient(code) {
  return code === 529 || code === 429 || code === 502 || code === 503 || code === 504;
}

export async function callClaudeWithBudget(payload, opts = {}) {
  const { timeoutMs = 45000, maxRetries = 6 } = opts;
  const started = Date.now();
  let attempt = 0;
  let delay = 500; // ms - start with longer initial delay

  while (true) {
    attempt++;
    const t0 = Date.now();
    console.log(`[retry] attempt=${attempt} budget_remaining=${timeoutMs - (Date.now() - started)}ms`);
    
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), Math.min(timeoutMs, 15000));
      
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(payload),
        signal: ctl.signal
      }).finally(() => clearTimeout(to));

      const ms = Date.now() - t0;

      if (res.ok) {
        const json = await res.json();
        const text = json?.content?.[0]?.text ?? "";
        if (!text) {
          console.log(`[retry] attempt=${attempt} result=empty_response ms=${ms}`);
          return { ok: false, code: 500, reason: "empty_response", ms, attempt };
        }
        console.log(`[retry] attempt=${attempt} result=success ms=${ms} tokens=${json?.usage?.output_tokens}`);
        return { 
          ok: true, 
          text, 
          tokens: json?.usage?.output_tokens ?? 0, 
          ms, 
          attempt 
        };
      }

      const code = res.status;
      const reason = `http_${code}`;
      console.log(`[retry] attempt=${attempt} result=http_${code} ms=${ms}`);
      
      // Retry transient errors if we have budget and attempts left
      if (isTransient(code) && attempt <= maxRetries && Date.now() - started + delay < timeoutMs) {
        const jitter = Math.floor(Math.random() * 300);
        console.log(`[retry] retrying after ${delay + jitter}ms backoff (transient ${code})`);
        await sleep(delay + jitter);
        delay = Math.min(delay * 2, 4000); // Allow longer delays up to 4s
        continue;
      }
      
      return { ok: false, code, reason, ms, attempt };
    } catch (e) {
      const ms = Date.now() - t0;
      const aborted = e?.name === "AbortError";
      const code = aborted ? 408 : 499;
      const reason = aborted ? "timeout" : e?.message || "network";
      console.log(`[retry] attempt=${attempt} result=error reason=${reason} ms=${ms}`);
      
      // Retry network errors if we have budget
      if (attempt <= maxRetries && Date.now() - started + delay < timeoutMs) {
        const jitter = Math.floor(Math.random() * 300);
        console.log(`[retry] retrying after ${delay + jitter}ms backoff (network error)`);
        await sleep(delay + jitter);
        delay = Math.min(delay * 2, 4000);
        continue;
      }
      
      return { ok: false, code, reason, ms, attempt };
    }
  }
}
