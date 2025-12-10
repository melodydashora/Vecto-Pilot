export function httpError(res, status, code, message, reqId, extra = {}) {
  return res.status(status).json({ ok: false, error: code, message, req_id: reqId, ...extra });
}

export function isPlusCode(address) {
  if (!address) return false;
  const trimmed = address.trim();
  return /^[A-Z0-9]{4,6}\+[A-Z0-9]{2,3}(\s|$)/.test(trimmed);
}

export function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
    
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {}
        }
      }
    }
    
    return null;
  }
}
