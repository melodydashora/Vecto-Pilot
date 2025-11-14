import express from "express";
// Using Node.js built-in fetch (available in Node 18+)
import type { Request, Response } from "express";

const app = express();
app.use(express.json({ limit: "5mb" }));

// Fast-path health probes
app.get('/health', (_req: Request, res: Response) => res.status(200).send('OK'));
app.get('/ready', (_req: Request, res: Response) => res.status(200).send('READY'));

const {
  CLAUDE_MODEL = "claude-sonnet-4-5-20250929",
  ANTHROPIC_API_KEY = "",
  ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1",
  ANTHROPIC_VERSION = "2023-06-01",
  OPENAI_MODEL = "gpt-5.1",
  OPENAI_API_KEY = "",
  GEMINI_MODEL = "gemini-2.5-pro",
  GEMINI_API_KEY = "",
  PERPLEXITY_API_KEY = "",
  PERPLEXITY_MODEL = "sonar-pro",
  EIDOLON_TOKEN = "",
  AGENT_TOKEN = "",
  EIDOLON_POLICY_PATH = "config/eidolon-policy.json",
  ASSISTANT_POLICY_PATH = "config/assistant-policy.json",
  REPL_SLUG = "",
  REPL_OWNER = "",
  REPL_ID = "",
} = process.env;

const FAIL = (res: Response, code: number, msg: string) =>
  res.status(code).json({ ok: false, error: msg });

const assertInvariants = (payload: any) => {
  if (!payload || typeof payload !== "object") throw new Error("INVALID_REQUEST");
  if (!payload.messages || !Array.isArray(payload.messages)) throw new Error("NO_MESSAGES");
};

const eidolonReply = async (payload: any) => {
  // Single-path strategist → planner → validator
  const strategist = await fetch(`${ANTR_BASE()}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      temperature: 0.2,
      system: await loadPolicy(EIDOLON_POLICY_PATH, "eidolon"),
      messages: payload.messages,
    }),
  }).then(r => r.json());

  const planner = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: "high" },
      max_output_tokens: 2048,
      input: [{ role: "user", content: [{ type: "text", text: planPrompt(strategist) }]}],
    }),
  }).then(r => r.json());

  const validator = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: validatePrompt(planner) }]}],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json" },
      safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
    }),
  }).then(r => r.json());

  const result = finalize(validator);
  return {
    identity: `🧠 Eidolon (Claude Sonnet 4.5 Enhanced SDK) • slug=${REPL_SLUG} owner=${REPL_OWNER}`,
    triad: { strategist, planner, validator },
    result,
  };
};

const ANTR_BASE = () => process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1";
const loadPolicy = async (path: string, who: string) => {
  const fs = await import("fs/promises");
  try { return await fs.readFile(path, "utf8"); } catch { return `${who.toUpperCase()} POLICY MISSING`; }
};
const planPrompt = (s: any) => `Convert strategist intent into exact steps and code edits:\n${JSON.stringify(s)}`;
const validatePrompt = (p: any) => `Validate JSON against schema, correct addresses, and normalize:\n${JSON.stringify(p)}`;
const finalize = (v: any) => {
  // Enforce schema-strict invariant, no invented venues
  const text = JSON.stringify(v);
  if (/\"venue\":\s*\"(TBD|invented|fake)\"/i.test(text)) throw new Error("INVARIANT_NO_VENUE_INVENTION");
  return v;
};

// Assistant entry point used by the IDE
app.post("/assistant/*", async (req: Request, res: Response) => {
  try {
    if (!EIDOLON_TOKEN) return FAIL(res, 401, "MISSING_EIDOLON_TOKEN");
    assertInvariants(req.body);
    const out = await eidolonReply(req.body);
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || "TRIAD_ERROR" });
  }
});

// Operational verbs redirected to Agent (kept separate so we never blur "brain" and "hands")
app.post("/ops/:verb", async (req: Request, res: Response) => {
  if (req.headers.authorization !== `Bearer ${AGENT_TOKEN}`) return FAIL(res, 401, "UNAUTHORIZED");
  const verb = req.params.verb;
  const allow = new Set(["fs.read", "fs.write", "shell.exec", "sql.query"]);
  if (!allow.has(verb)) return FAIL(res, 403, "VERB_NOT_ALLOWED");
  const r = await fetch(process.env.AGENT_BASE_URL + "/op/" + verb, {
    method: "POST",
    headers: { authorization: `Bearer ${AGENT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(req.body),
  });
  res.status(r.status).send(await r.text());
});

const port = Number(process.env.GATEWAY_PORT || 5000);
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () =>
  console.log(`[gateway] assistant listening on ${host}:${port}`)
);

// Tighten timeouts to prevent hung probes
(server as any).requestTimeout = 5000;
(server as any).headersTimeout = 6000;
(server as any).keepAliveTimeout = 5000;
