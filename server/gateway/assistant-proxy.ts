import express from "express";
import type { Request, Response } from "express";
// @ts-ignore
import { callModel } from "../lib/ai/adapters/index.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// Fast-path health probes
app.get('/health', (_req: Request, res: Response) => res.status(200).send('OK'));
app.get('/ready', (_req: Request, res: Response) => res.status(200).send('READY'));

const {
  EIDOLON_TOKEN = "",
  AGENT_TOKEN = "",
  EIDOLON_POLICY_PATH = "config/eidolon-policy.json",
  REPL_SLUG = "",
  REPL_OWNER = "",
} = process.env;

const FAIL = (res: Response, code: number, msg: string) =>
  res.status(code).json({ ok: false, error: msg });

const assertInvariants = (payload: any) => {
  if (!payload || typeof payload !== "object") throw new Error("INVALID_REQUEST");
  if (!payload.messages || !Array.isArray(payload.messages)) throw new Error("NO_MESSAGES");
};

const eidolonReply = async (payload: any) => {
  // Single-path strategist → planner → validator
  
  // 1. STRATEGIST (Claude Opus)
  const strategistResult = await callModel('STRATEGY_CORE', {
    system: await loadPolicy(EIDOLON_POLICY_PATH, "eidolon"),
    messages: payload.messages, // Pass full history
  });

  if (!strategistResult.ok) throw new Error(`Strategist failed: ${strategistResult.error}`);
  const strategistOutput = strategistResult.output;

  // 2. PLANNER (GPT-5.2)
  const plannerResult = await callModel('STRATEGY_TACTICAL', {
    user: planPrompt(strategistOutput),
  });

  if (!plannerResult.ok) throw new Error(`Planner failed: ${plannerResult.error}`);
  const plannerOutput = JSON.parse(plannerResult.output); // GPT usually returns JSON string if prompted, or we might need to parse

  // 3. VALIDATOR (Gemini 3 Pro)
  // Using BRIEFING_EVENTS_VALIDATOR which maps to Claude Opus in registry, 
  // but we want Gemini as per original code. 
  // Let's use STRATEGY_CONTEXT (Gemini 3 Pro) or override.
  // Ideally we stick to registry roles. 
  // The original code used "GEMINI_MODEL" directly.
  // We'll use 'STRATEGY_CONTEXT' as it is a Gemini 3 Pro role.
  const validatorResult = await callModel('STRATEGY_CONTEXT', {
    user: validatePrompt(plannerOutput),
  });

  if (!validatorResult.ok) throw new Error(`Validator failed: ${validatorResult.error}`);
  let validatorOutput;
  try {
     validatorOutput = JSON.parse(validatorResult.output);
  } catch (e) {
     // If not JSON, just return text wrapped
     validatorOutput = { result: validatorResult.output };
  }

  const result = finalize(validatorOutput);
  return {
    identity: `🧠 Eidolon (Claude Opus 4.6 Enhanced) • slug=${REPL_SLUG} owner=${REPL_OWNER}`,
    triad: { strategist: strategistOutput, planner: plannerOutput, validator: validatorOutput },
    result,
  };
};

const loadPolicy = async (path: string, who: string) => {
  const fs = await import("fs/promises");
  try { return await fs.readFile(path, "utf8"); } catch { return `${who.toUpperCase()} POLICY MISSING`; }
};
const planPrompt = (s: string) => `Convert strategist intent into exact steps and code edits:\n${s}`;
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
