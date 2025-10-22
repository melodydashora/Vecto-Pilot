// server/lib/ability-routes.js
// Centralized parity routes for all three lanes

// Using Node.js built-in fetch (available in Node 18+)
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from '../db/drizzle.js';
import { sql as drizzleSql } from 'drizzle-orm';
import { jobQueue } from './job-queue.js';

const pexec = promisify(execFile);

export function mountAbilityRoutes(app, id, caps, exec) {
  app.get("/whoami", async (_req, res) => res.json({ ok: true, id }));
  app.get("/capabilities", async (_req, res) => res.json({ ok: true, caps }));

  app.post("/fs/read", async (req, res) => {
    if (!caps.fsRead) return res.status(403).json({ ok: false, error: "fs_read_disabled" });
    const { path } = req.body || {};
    try { 
      res.json({ ok: true, data: await exec.fsRead(path) }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });

  app.post("/fs/write", async (req, res) => {
    if (!caps.fsWrite) return res.status(403).json({ ok: false, error: "fs_write_disabled" });
    const { path, content } = req.body || {};
    try { 
      res.json({ ok: true, data: await exec.fsWrite(path, content) }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });

  app.post("/shell/exec", async (req, res) => {
    if (!caps.shell) return res.status(403).json({ ok: false, error: "shell_disabled" });
    const { cmd, args = [] } = req.body || {};
    try { 
      res.json({ ok: true, data: await exec.shell(cmd, args) }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });

  app.post("/sql/query", async (req, res) => {
    const { sql } = req.body || {};
    try { 
      res.json({ ok: true, data: await exec.sql(sql) }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });

  app.get("/metrics/jobs", async (_req, res) => {
    try { 
      res.json({ ok: true, data: await exec.metrics() }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });

  app.post("/memory/get", async (req, res) => {
    const { key } = req.body || {};
    try { 
      res.json({ ok: true, data: await exec.memoryGet(key) }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });

  app.post("/memory/put", async (req, res) => {
    const { key, value } = req.body || {};
    try { 
      res.json({ ok: true, data: await exec.memoryPut(key, value) }); 
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e?.message || e) }); 
    }
  });
}

// Local executor for Agent
export function makeLocalExecutor(caps) {
  return {
    async whoami() { 
      return { pid: process.pid, service: 'agent-local' }; 
    },
    
    async fsRead(p) { 
      return { path: p, content: await fs.readFile(p, "utf8") }; 
    },
    
    async fsWrite(p, c) { 
      await fs.writeFile(p, c, "utf8"); 
      return { path: p, bytes: Buffer.byteLength(c) }; 
    },
    
    async shell(cmd, args) {
      const out = await pexec(cmd, args, { encoding: "utf8", timeout: 15000 });
      return { stdout: out.stdout, stderr: out.stderr };
    },
    
    async sql(q) { 
      const result = await db.execute(drizzleSql.raw(q));
      return { rows: result.rows || result };
    },
    
    async metrics() { 
      const metrics = jobQueue.getMetrics();
      return metrics;
    },
    
    async memoryGet(k) { 
      // Placeholder - integrate with actual memory backend
      return { key: k, value: null }; 
    },
    
    async memoryPut(k, v) { 
      // Placeholder - integrate with actual memory backend
      return { key: k, ok: true }; 
    },
  };
}

// Remote executor that forwards to Agent so powers stay identical
export function makeRemoteExecutor(agentBase, agentToken) {
  const call = async (path, init) => {
    const r = await fetch(`${agentBase}${path}`, {
      ...init,
      headers: { 
        "content-type": "application/json", 
        "authorization": `Bearer ${agentToken}`, 
        ...(init?.headers || {}) 
      },
    });
    const txt = await r.text();
    try { 
      return { status: r.status, body: JSON.parse(txt) }; 
    } catch { 
      return { status: r.status, body: { error: txt } }; 
    }
  };
  
  return {
    async whoami() { 
      return (await call("/agent/whoami")).body; 
    },
    
    async fsRead(p) { 
      return (await call("/agent/fs/read", { 
        method: "POST", 
        body: JSON.stringify({ path: p })
      })).body; 
    },
    
    async fsWrite(p, c) { 
      return (await call("/agent/fs/write", {
        method: "POST", 
        body: JSON.stringify({ path: p, content: c })
      })).body; 
    },
    
    async shell(cmd, args) { 
      return (await call("/agent/shell/exec", {
        method: "POST", 
        body: JSON.stringify({ cmd, args })
      })).body; 
    },
    
    async sql(q) { 
      return (await call("/agent/sql/query", {
        method: "POST", 
        body: JSON.stringify({ sql: q })
      })).body; 
    },
    
    async metrics() { 
      return (await call("/agent/metrics/jobs", { method: "GET" })).body; 
    },
    
    async memoryGet(k) { 
      return (await call("/agent/memory/get", {
        method: "POST", 
        body: JSON.stringify({ key: k })
      })).body; 
    },
    
    async memoryPut(k, v) { 
      return (await call("/agent/memory/put", {
        method: "POST", 
        body: JSON.stringify({ key: k, value: v })
      })).body; 
    },
  };
}
