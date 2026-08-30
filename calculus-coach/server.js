// Calc Coach server — zero dependencies, Node 18+.
// Serves the static app, the curriculum content, and a small JSON progress API
// backed by files in ./data (so progress survives browser changes on Replit).

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CONTENT = join(ROOT, 'content');
const DATA = join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
};
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj));

// Only allow simple profile names so the file path can never escape ./data.
const profileFile = (name) => {
  const safe = String(name || 'learner').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return join(DATA, `progress-${safe || 'learner'}.json`);
};

async function serveFile(res, base, relPath) {
  const path = normalize(join(base, relPath));
  if (!path.startsWith(base)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(path);
    const ext = path.slice(path.lastIndexOf('.'));
    send(res, 200, body, MIME[ext] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  try {
    if (path === '/api/health') return sendJson(res, 200, { ok: true, app: 'calc-coach' });

    if (path === '/api/progress') {
      const file = profileFile(url.searchParams.get('profile'));
      if (req.method === 'GET') {
        try {
          return send(res, 200, await readFile(file, 'utf8'));
        } catch {
          return sendJson(res, 200, null); // no saved progress yet — the client starts fresh
        }
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req);
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
        if (typeof parsed !== 'object' || parsed === null) return sendJson(res, 400, { error: 'body must be a JSON object' });
        await mkdir(DATA, { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8');
        await rename(tmp, file); // atomic: never leaves a half-written progress file
        return sendJson(res, 200, { saved: true });
      }
      return sendJson(res, 405, { error: 'use GET or PUT' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    if (path.startsWith('/content/')) return serveFile(res, CONTENT, path.slice('/content/'.length));
    if (path === '/' || path === '/index.html') return serveFile(res, PUBLIC, 'index.html');
    return serveFile(res, PUBLIC, path.slice(1));
  } catch (e) {
    console.error(`[calc-coach] ${req.method} ${path} failed:`, e.message);
    sendJson(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[calc-coach] listening on http://0.0.0.0:${PORT}`);
});
