#!/usr/bin/env node
// scripts/query-prod.js — terminal client for the PROD read-only query bridge.
//
// WHY: prod (current Replit infra) is app-scoped — the dev terminal can't reach the
// prod DB directly. This script calls the deployed app's read-only bridge over HTTPS.
// See docs/architecture/PROD_QUERY_BRIDGE.md.
//
// Usage:
//   node scripts/query-prod.js --monitor [--limit=50]                       structured offer monitor
//   node scripts/query-prod.js "SELECT ai_model, decision FROM offer_intelligence LIMIT 10"   raw read-only SELECT
//   node scripts/query-prod.js --monitor --out=temp/prod-eval.json          also write JSON to a file
//
// Auth: signs with CLAUDE_BRIDGE_TOKEN (or VECTO_AGENT_SECRET) from the local env.
// Target host defaults to https://vectopilot.com (override with VECTO_PROD_BASE_URL).

import fs from 'node:fs/promises';

const BASE = process.env.VECTO_PROD_BASE_URL || 'https://vectopilot.com';
const TOKEN = process.env.CLAUDE_BRIDGE_TOKEN || process.env.VECTO_AGENT_SECRET;

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v === undefined ? true : v;
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main() {
  if (!TOKEN) {
    console.error('Missing CLAUDE_BRIDGE_TOKEN (or VECTO_AGENT_SECRET) in the environment.');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const headers = { 'x-claude-bridge-token': TOKEN, 'content-type': 'application/json' };

  let url;
  let init;
  if (args.monitor) {
    const q = args.limit ? `?limit=${encodeURIComponent(args.limit)}` : '';
    url = `${BASE}/api/admin/offer-monitor${q}`;
    init = { method: 'GET', headers };
  } else {
    const sqlText = args._.join(' ').trim();
    if (!sqlText) {
      console.error('Provide a SELECT query, or use --monitor.');
      process.exit(1);
    }
    url = `${BASE}/api/admin/query`;
    init = { method: 'POST', headers, body: JSON.stringify({ sql: sqlText }) };
  }

  const resp = await fetch(url, init);
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!resp.ok) {
    console.error(`HTTP ${resp.status}:`, JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const pretty = JSON.stringify(json, null, 2);
  console.log(pretty);
  if (args.out) {
    await fs.writeFile(args.out, pretty);
    console.error(`\n→ wrote ${args.out}`);
  }
}

main().catch((e) => {
  console.error('query-prod failed:', e.message);
  process.exit(1);
});
