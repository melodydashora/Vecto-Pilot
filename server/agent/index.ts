import express from "express";
import { execFile } from "child_process";
import fs from "fs/promises";
import { Client } from "pg";
const app = express(); app.use(express.json());

const allowShell = new Set(String(process.env.AGENT_SHELL_WHITELIST || "")
  .split(",").map(s => s.trim()).filter(Boolean));

const auth = (req: any, res: any, next: any) =>
  req.headers.authorization === `Bearer ${process.env.AGENT_TOKEN}`
    ? next() : res.status(401).json({ ok:false, error:"UNAUTHORIZED" });

app.post("/op/fs.read", auth, async (req, res) => {
  const { path, enc = "utf8" } = req.body || {};
  const data = await fs.readFile(path, enc);
  res.json({ ok: true, data });
});

app.post("/op/fs.write", auth, async (req, res) => {
  const { path, data, enc = "utf8" } = req.body || {};
  await fs.mkdir(require("path").dirname(path), { recursive: true });
  await fs.writeFile(path, data, enc);
  res.json({ ok: true });
});

app.post("/op/shell.exec", auth, async (req, res) => {
  const { cmd, args = [] } = req.body || {};
  
  // Check if wildcard is enabled
  if (allowShell.has("*") || allowShell.has(cmd)) {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return res.status(400).json({ ok:false, error:String(err), stderr });
      res.json({ ok:true, stdout, stderr });
    });
  } else {
    return res.status(403).json({ ok:false, error:"CMD_NOT_ALLOWED" });
  }
});

app.post("/op/sql.query", auth, async (req, res) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }});
  await client.connect();
  try {
    const { text, values } = req.body || {};
    const r = await client.query(text, values);
    res.json({ ok:true, rows: r.rows, count: r.rowCount });
  } finally { await client.end(); }
});

const port = Number(process.env.AGENT_PORT || 43717);
app.listen(port, () => console.log(`[agent] :${port} ready`));
