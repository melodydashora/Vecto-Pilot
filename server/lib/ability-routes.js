/**
 * Ability-based routing for agent servers
 *
 * Mounts standardized routes based on enabled capabilities.
 * Provides a unified interface for file, shell, SQL, and memory operations.
 *
 * @module ability-routes
 */

import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BASE_DIR = process.env.BASE_DIR || "/home/runner/workspace";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMMAND_TIMEOUT = 60_000; // 60s

/**
 * Create a local executor for ability routes
 * Handles actual file/shell/sql operations
 *
 * @param {Object} caps - Capabilities object from capsFromEnv
 * @returns {Object} Executor with methods for each ability
 */
export function makeLocalExecutor(caps) {
  return {
    /**
     * Read file contents
     */
    async fsRead(filePath) {
      const abs = resolveSafe(filePath);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) throw new Error("not-a-file");
      if (stat.size > MAX_FILE_SIZE) throw new Error("file-too-large");
      const content = await fs.readFile(abs, "utf8");
      return { path: filePath, content, size: stat.size, modified: stat.mtime };
    },

    /**
     * Write file contents
     */
    async fsWrite(filePath, content) {
      const abs = resolveSafe(filePath);
      const size = Buffer.byteLength(content, "utf8");
      if (size > MAX_FILE_SIZE) throw new Error("file-too-large");
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return { path: filePath, success: true, bytes: size };
    },

    /**
     * List directory contents
     */
    async fsList(dirPath) {
      const abs = resolveSafe(dirPath);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other"
      }));
    },

    /**
     * Execute shell command
     */
    async shellExec(cmd, args = []) {
      const options = {
        cwd: BASE_DIR,
        timeout: COMMAND_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env }
      };

      try {
        const { stdout, stderr } = await execFileAsync(cmd, args, options);
        return { stdout: stdout || "", stderr: stderr || "", exitCode: 0 };
      } catch (err) {
        return {
          stdout: err.stdout || "",
          stderr: err.stderr || err.message || "",
          exitCode: typeof err.code === "number" ? err.code : 1
        };
      }
    }
  };
}

/**
 * Resolve path safely within BASE_DIR
 * @param {string} p - Requested path
 * @returns {string} Absolute safe path
 */
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

/**
 * Mount ability routes on an Express router
 *
 * @param {Router} router - Express router to mount routes on
 * @param {string} prefix - Route prefix (used for logging)
 * @param {Object} caps - Capabilities object from capsFromEnv
 * @param {Object} executor - Executor from makeLocalExecutor
 */
export function mountAbilityRoutes(router, prefix, caps, executor) {
  // File system abilities
  if (caps.fsRead) {
    router.post("/ability/fs/read", async (req, res, next) => {
      try {
        const { path: filePath } = req.body || {};
        if (!filePath) return res.status(400).json({ ok: false, error: "path_required" });
        const result = await executor.fsRead(filePath);
        res.json({ ok: true, ...result });
      } catch (err) {
        next(err);
      }
    });

    router.post("/ability/fs/list", async (req, res, next) => {
      try {
        const { path: dirPath = "." } = req.body || {};
        const result = await executor.fsList(dirPath);
        res.json({ ok: true, entries: result });
      } catch (err) {
        next(err);
      }
    });
  }

  if (caps.fsWrite) {
    router.post("/ability/fs/write", async (req, res, next) => {
      try {
        const { path: filePath, content } = req.body || {};
        if (!filePath) return res.status(400).json({ ok: false, error: "path_required" });
        if (content === undefined) return res.status(400).json({ ok: false, error: "content_required" });
        const result = await executor.fsWrite(filePath, content);
        res.json({ ok: true, ...result });
      } catch (err) {
        next(err);
      }
    });
  }

  // Shell abilities
  if (caps.shellExec) {
    router.post("/ability/shell/exec", async (req, res, next) => {
      try {
        const { cmd, args = [] } = req.body || {};
        if (!cmd) return res.status(400).json({ ok: false, error: "cmd_required" });
        const result = await executor.shellExec(cmd, args);
        res.json({ ok: true, ...result });
      } catch (err) {
        next(err);
      }
    });
  }

  // Capabilities introspection
  router.get("/ability/caps", (_req, res) => {
    res.json({
      ok: true,
      prefix,
      capabilities: {
        fsRead: !!caps.fsRead,
        fsWrite: !!caps.fsWrite,
        fsDelete: !!caps.fsDelete,
        shellExec: !!caps.shellExec,
        sqlQuery: !!caps.sqlQuery,
        sqlExecute: !!caps.sqlExecute,
        memoryRead: !!caps.memoryRead,
        memoryWrite: !!caps.memoryWrite
      }
    });
  });
}
