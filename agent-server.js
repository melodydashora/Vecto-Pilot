import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import pkg from "pg";
const { Pool } = pkg;
import { capsFromEnv } from "./server/lib/capabilities.js";
import { bearer } from "./server/lib/auth.js";
import { makeLocalExecutor, mountAbilityRoutes } from "./server/lib/ability-routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

// Configuration
const BASE_DIR = process.env.BASE_DIR || "/home/runner/workspace";
const PORT = Number(process.env.AGENT_PORT || process.env.DEFAULT_AGENT_PORT || 43717);
const HOST = process.env.AGENT_HOST || "127.0.0.1"; // loopback by default
const TOKEN = process.env.AGENT_TOKEN || null;
const IS_REPLIT = process.env.REPL_ID !== undefined;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMMAND_TIMEOUT = 60_000; // 60s for shell ops
const LOG_DIR = path.resolve(__dirname, "data", "agent-logs");

// PostgreSQL connection
let dbPool = null;
function getDBPool() {
  if (!dbPool && process.env.DATABASE_URL) {
    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : false
    });
  }
  return dbPool;
}

// Validation schemas
const schemas = {
  path: z.object({
    path: z.string().min(1).max(1000)
  }),
  write: z.object({
    path: z.string().min(1).max(1000),
    content: z.string().max(MAX_FILE_SIZE)
  }),
  shell: z.object({
    cmd: z.string().min(1).max(100),
    args: z.array(z.string().max(1000)).max(50).optional().default([])
  }),
  sql: z.object({
    sql: z.string().min(1).max(50_000),
    params: z.array(z.any()).max(100).optional().default([])
  })
};

// Command whitelist
const ALLOWED_COMMANDS = new Set([
  // File system
  "ls", "cat", "echo", "pwd", "grep", "find", "wc",
  "head", "tail", "sort", "uniq", "diff", "tree",
  // Node.js ecosystem
  "node", "npm", "npx", "yarn", "pnpm",
  // Build tools
  "tsc", "tsx", "vite", "webpack", "rollup", "esbuild",
  // Git
  "git",
  // Process management
  "ps", "kill", "pkill"
]);

// Safe npm subcommands
const SAFE_NPM_COMMANDS = new Set([
  "install", "ci", "update", "list", "outdated", "audit",
  "run", "test", "build", "start", "dev", "lint"
]);

// Initialize logging directory
await fs.mkdir(LOG_DIR, { recursive: true });

// Utilities
function nowTS() {
  return new Date().toISOString();
}

async function writeLog(kind, payload) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(LOG_DIR, `${stamp}_${kind}.log.json`);
    const logData = {
      ts: nowTS(),
      kind,
      pid: process.pid,
      replit: IS_REPLIT,
      ...payload
    };
    await fs.writeFile(file, JSON.stringify(logData, null, 2), "utf8");
  } catch (err) {
    console.error(`Failed to write log: ${err.message}`);
  }
}

function randomId(n = 8) {
  return crypto.randomBytes(n).toString("hex");
}

function resolveSafe(p) {
  const abs = path.resolve(BASE_DIR, p);
  const base = path.resolve(BASE_DIR);
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    const err = new Error("path-outside-base");
    err.code = "PATH_OUTSIDE_BASE";
    throw err;
  }
  return abs;
}

function bearerOrHeaderToken(req) {
  const hdr = req.get("authorization");
  if (hdr && /^bearer\s+/i.test(hdr)) return hdr.replace(/^bearer\s+/i, "").trim();
  const x = req.get("x-agent-token");
  if (x) return x.trim();
  return null;
}

// Express app
const app = express();
app.disable("x-powered-by");

// CORS: internal use via gateway; permissive for dev
app.use(cors({ origin: true, credentials: false }));

// Parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Rate limit (tight for safety)
const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Health (must be BEFORE auth middleware so it's publicly accessible)
app.get("/agent/health", (_req, res) => {
  res.json({
    status: "healthy",
    env: IS_PRODUCTION ? "production" : "development",
    host: HOST,
    port: PORT,
    baseDir: BASE_DIR,
    replit: IS_REPLIT
  });
});

// Parity contract: unified capability routes
const caps = capsFromEnv("AGENT");
const agentRouter = express.Router();

// Auth gate (if TOKEN set, require it) - using unified bearer auth
if (TOKEN) {
  agentRouter.use(bearer(TOKEN, "x-agent-token"));
}

// Shell whitelist enforcement for parity routes
agentRouter.use("/shell/exec", (req, res, next) => {
  const wl = caps.shellWhitelist;
  if (!wl?.length) return next();
  const { cmd } = req.body || {};
  if (!cmd || !wl.includes(cmd)) {
    return res.status(403).json({ ok: false, error: "shell_command_not_allowed" });
  }
  next();
});

mountAbilityRoutes(agentRouter, "agent", caps, makeLocalExecutor(caps));
app.use("/agent", agentRouter);

// FS: read
app.post("/agent/fs/read", async (req, res, next) => {
  const id = randomId();
  try {
    const { path: p } = schemas.path.parse(req.body || {});
    const abs = resolveSafe(p);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      const e = new Error("not-a-file");
      e.code = "NOT_A_FILE";
      throw e;
    }
    if (stat.size > MAX_FILE_SIZE) {
      const e = new Error("file-too-large");
      e.code = "FILE_TOO_LARGE";
      throw e;
    }
    const content = await fs.readFile(abs, "utf8");
    await writeLog("fs.read", { id, p, abs, size: stat.size });
    res.json({ path: p, content, size: stat.size, modified: stat.mtime });
  } catch (err) {
    await writeLog("fs.read.error", { id, message: err.message, code: err.code });
    next(err);
  }
});

// FS: write
app.post("/agent/fs/write", async (req, res, next) => {
  const id = randomId();
  try {
    const { path: p, content } = schemas.write.parse(req.body || {});
    const abs = resolveSafe(p);
    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_FILE_SIZE) {
      const e = new Error("file-too-large");
      e.code = "FILE_TOO_LARGE";
      throw e;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    await writeLog("fs.write", { id, p, abs, size });
    res.json({ path: p, success: true, bytes: size, timestamp: nowTS() });
  } catch (err) {
    await writeLog("fs.write.error", { id, message: err.message, code: err.code });
    next(err);
  }
});

// Shell exec (whitelisted, no shell interpolation)
app.post("/agent/shell", async (req, res, next) => {
  const id = randomId();
  try {
    const { cmd, args = [] } = schemas.shell.parse(req.body || {});
    if (!ALLOWED_COMMANDS.has(cmd)) {
      const e = new Error("command-not-allowed");
      e.code = "CMD_DENY";
      throw e;
    }
    if (cmd === "npm") {
      const sub = args[0] || "";
      if (!SAFE_NPM_COMMANDS.has(sub)) {
        const e = new Error("npm-subcommand-not-allowed");
        e.code = "NPM_DENY";
        throw e;
      }
    }
    const options = {
      cwd: BASE_DIR,
      timeout: COMMAND_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env }
    };

    const started = Date.now();
    let stdout = "", stderr = "", exitCode = 0;
    try {
      const out = await execFileAsync(cmd, args, options);
      stdout = out.stdout ?? "";
      stderr = out.stderr ?? "";
      exitCode = 0;
    } catch (err) {
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? String(err.message || "");
      exitCode = typeof err.code === "number" ? err.code : 1;
    }
    const elapsedMs = Date.now() - started;

    await writeLog("shell.exec", { id, cmd, args, exitCode, elapsedMs, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr) });
    res.json({ stdout, stderr, exitCode, elapsedMs });
  } catch (err) {
    await writeLog("shell.exec.error", { id, message: err.message, code: err.code });
    next(err);
  }
});

// SQL: SELECT
app.post("/agent/sql/query", async (req, res, next) => {
  const id = randomId();
  try {
    const pool = getDBPool();
    if (!pool) {
      const e = new Error("database-not-configured");
      e.code = "DB_CONFIG";
      throw e;
    }
    const { sql, params } = schemas.sql.parse(req.body || {});
    const result = await pool.query(sql, params);
    await writeLog("sql.query", { id, rows: result.rowCount });
    res.json({ rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    await writeLog("sql.query.error", { id, message: err.message, code: err.code });
    next(err);
  }
});

// SQL: DML/DDL
app.post("/agent/sql/execute", async (req, res, next) => {
  const id = randomId();
  try {
    const pool = getDBPool();
    if (!pool) {
      const e = new Error("database-not-configured");
      e.code = "DB_CONFIG";
      throw e;
    }
    const { sql, params } = schemas.sql.parse(req.body || {});
    const result = await pool.query(sql, params);
    await writeLog("sql.execute", { id, rowCount: result.rowCount });
    res.json({ affectedRows: result.rowCount });
  } catch (err) {
    await writeLog("sql.execute.error", { id, message: err.message, code: err.code });
    next(err);
  }
});

// Config Management
app.get("/agent/config/list", async (req, res, next) => {
  try {
    const { listConfigFiles } = await import("./server/agent/config-manager.js");
    const files = await listConfigFiles();
    res.json({ ok: true, files });
  } catch (err) {
    next(err);
  }
});

app.get("/agent/config/read/:filename", async (req, res, next) => {
  try {
    const { readConfigFile } = await import("./server/agent/config-manager.js");
    const result = await readConfigFile(req.params.filename);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/agent/config/env/update", async (req, res, next) => {
  try {
    const { updateEnvFile } = await import("./server/agent/config-manager.js");
    const { updates } = req.body || {};
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ ok: false, error: "missing_updates" });
    }
    const result = await updateEnvFile(updates);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/agent/config/backup/:filename", async (req, res, next) => {
  try {
    const { backupConfigFile } = await import("./server/agent/config-manager.js");
    const result = await backupConfigFile(req.params.filename);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Context Awareness & Memory
app.get("/agent/context", async (req, res, next) => {
  try {
    const { getProjectContext } = await import("./server/agent/context-awareness.js");
    const context = await getProjectContext();
    res.json({ ok: true, context });
  } catch (err) {
    next(err);
  }
});

app.get("/agent/context/summary", async (req, res, next) => {
  try {
    const { getProjectSummary } = await import("./server/agent/context-awareness.js");
    const summary = await getProjectSummary();
    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

app.post("/agent/memory/preference", async (req, res, next) => {
  try {
    const { saveUserPreference } = await import("./server/agent/context-awareness.js");
    const { key, value, userId } = req.body || {};
    if (!key) {
      return res.status(400).json({ ok: false, error: "missing_key" });
    }
    const result = await saveUserPreference(key, value, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/agent/memory/session", async (req, res, next) => {
  try {
    const { saveSessionState } = await import("./server/agent/context-awareness.js");
    const { key, value, userId } = req.body || {};
    if (!key) {
      return res.status(400).json({ ok: false, error: "missing_key" });
    }
    const result = await saveSessionState(key, value, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/agent/memory/project", async (req, res, next) => {
  try {
    const { saveProjectState } = await import("./server/agent/context-awareness.js");
    const { key, value, userId } = req.body || {};
    if (!key) {
      return res.status(400).json({ ok: false, error: "missing_key" });
    }
    const result = await saveProjectState(key, value, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Enhanced context endpoint
app.get("/agent/context/enhanced", async (req, res, next) => {
  try {
    const { getEnhancedProjectContext } = await import("./server/agent/enhanced-context.js");
    const context = await getEnhancedProjectContext();
    res.json({ ok: true, context });
  } catch (err) {
    next(err);
  }
});

// Internet search endpoint
app.post("/agent/search/internet", async (req, res, next) => {
  try {
    const { performInternetSearch } = await import("./server/agent/enhanced-context.js");
    const { query, userId } = req.body || {};
    if (!query) {
      return res.status(400).json({ ok: false, error: "query_required" });
    }
    const result = await performInternetSearch(query, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Deep workspace analysis endpoint
app.get("/agent/analyze/deep", async (req, res, next) => {
  try {
    const { analyzeWorkspaceDeep } = await import("./server/agent/enhanced-context.js");
    const analysis = await analyzeWorkspaceDeep();
    res.json({ ok: true, analysis });
  } catch (err) {
    next(err);
  }
});

app.post("/agent/memory/conversation", async (req, res, next) => {
  try {
    const { rememberConversation } = await import("./server/agent/context-awareness.js");
    const { topic, summary, userId } = req.body || {};
    if (!topic || !summary) {
      return res.status(400).json({ ok: false, error: "missing_topic_or_summary" });
    }
    const result = await rememberConversation(topic, summary, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/agent/memory/conversations", async (req, res, next) => {
  try {
    const { getRecentConversations } = await import("./server/agent/context-awareness.js");
    const { userId, limit } = req.query || {};
    const conversations = await getRecentConversations(userId, limit ? parseInt(limit) : 10);
    res.json({ ok: true, conversations });
  } catch (err) {
    next(err);
  }
});

// Not found
app.use((req, res) => {
  res.status(404).json({ error: "not-found", path: req.path });
});

// Error handler
app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: "validation-error", details: err.issues });
  }
  const code = err.code || "INTERNAL";
  const status =
    code === "PATH_OUTSIDE_BASE" ? 400 :
    code === "FILE_TOO_LARGE" ? 413 :
    code === "CMD_DENY" ? 403 :
    code === "NPM_DENY" ? 403 :
    code === "DB_CONFIG" ? 503 :
    500;
  res.status(status).json({ error: String(code).toLowerCase(), message: err.message || "internal-error" });
});

// Startup
app.listen(PORT, HOST, () => {
  console.log(`[agent] Listening on ${HOST}:${PORT}`);
  console.log(`[agent] Base directory: ${BASE_DIR}`);
  console.log(`[agent] Environment: ${IS_REPLIT ? "REPLIT" : "LOCAL"} ${IS_PRODUCTION ? "PROD" : "DEV"}`);
  if (TOKEN) console.log(`[agent] Token auth: enabled`);
});

// Graceful shutdown
function shutdown() {
  console.log("[agent] Shutting down…");
  if (dbPool) {
    dbPool.end().catch(() => {}).finally(() => process.exit(0));
  } else {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
