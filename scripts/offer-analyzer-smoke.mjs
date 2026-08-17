#!/usr/bin/env node
// scripts/offer-analyzer-smoke.mjs — hit a running Offer Analyzer with the same requests a
// phone shortcut sends and print what the driver would hear/see. Replaces the stale
// tests/integration/test-ocr-hook.js (2026-08-17; it expected a response shape from 2026-02).
//
// Usage:
//   node scripts/offer-analyzer-smoke.mjs                          # text + built-in cards against http://localhost:5000
//   BASE=https://vectopilot.com TOKEN=vp_… node scripts/offer-analyzer-smoke.mjs
//   IMAGE=/path/to/screenshot.jpg node scripts/offer-analyzer-smoke.mjs   # add a real screenshot (vision lane, multipart)
//   IMAGE=… RAW=1 node scripts/offer-analyzer-smoke.mjs                    # same screenshot as a RAW image body (MacroDroid file-body mode)
//   TEXT="UberX\n$14.20\n…" node scripts/offer-analyzer-smoke.mjs         # custom OCR text
//
// Prints per request: decision | voice | notification | server response_time_ms | wall ms.
// Wall − server = network + parsing overhead on THIS machine (a phone adds OCR/TTS on top).
// Read-only against the endpoint (each call may store a row for the tokened driver).
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:5000';
const TOKEN = process.env.TOKEN || '';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Shortcuts/2026 offer-analyzer-smoke';
const headers = { 'User-Agent': UA, ...(TOKEN ? { 'X-Shortcut-Token': TOKEN } : {}) };

const TEXTS = process.env.TEXT ? { custom: process.env.TEXT.replace(/\\n/g, '\n') } : {
  'text A (UberX Priority, on the way, $1.40/mi)': 'On the way\nUberX Priority\n$8.54\n★ 4.92 ✓ Verified\n4 min (1.9 mi) away\nThe Star Blvd & Winning Dr, Frisco\n10 min (4.2 mi) trip\nBasilica Ln & Santa Bella Dr, Frisco\nMatch',
  'text B (fast REJECT: low pay + long pickup)': 'UberX\n$6.20\n★ 4.95 ✓ Verified\n7 min (3.4 mi) away\nMain St, Frisco\n12 min (5.1 mi) trip\nEldorado Pkwy, Frisco\nAccept',
  'text C (share)': 'Share\n$5.62\n6 min (2.4 mi) away\n11 min (4.8 mi) trip\nAccept',
};

async function post(label, init) {
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(`${BASE}/api/hooks/analyze-offer`, { method: 'POST', ...init });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    console.log(`${label}\n  ✗ ${err.message}`); return;
  }
  const wall = Date.now() - t0;
  if (!res.ok) { console.log(`${label}\n  ✗ HTTP ${res.status} ${JSON.stringify(body).slice(0, 160)}`); return; }
  console.log(`${label}\n  ${body.decision} | ${body.voice} | ${body.notification} | server ${body.response_time_ms} ms | wall ${wall} ms${body.duplicate ? ' | DUPLICATE (replayed, Phase 1/2 skipped)' : ''}`);
}

console.log(`Offer Analyzer smoke → ${BASE}  token: ${TOKEN ? 'yes (' + TOKEN.slice(0, 5) + '…)' : 'NO (default rules, anonymous)'}`);
for (const [label, text] of Object.entries(TEXTS)) {
  await post(label, { headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source: 'smoke_text', device_id: 'smoke' }) });
}
// 2026-08-17: idempotency check — an identical re-send inside 60 s must come back with
// duplicate:true (replayed answer, no second model call, no second row).
{
  const [label, text] = Object.entries(TEXTS)[0];
  await post(`${label} — RE-SENT (expect DUPLICATE)`, { headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source: 'smoke_text', device_id: 'smoke' }) });
}
if (process.env.IMAGE) {
  const p = process.env.IMAGE;
  const buf = fs.readFileSync(p);
  const type = p.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type }), path.basename(p));
  fd.append('source', 'smoke_vision');
  fd.append('device_id', 'smoke');
  await post(`vision (${path.basename(p)}, ${Math.round(buf.length / 1024)} KB)`, { headers, body: fd });
  if (process.env.RAW) {
    // 2026-08-17: raw image body — what MacroDroid "Content Body: File" sends. Fields ride the query string.
    const rawUrl = `${BASE}/api/hooks/analyze-offer?source=smoke_vision_raw&device_id=smoke`;
    const t0 = Date.now();
    const res = await fetch(rawUrl, { method: 'POST', headers: { ...headers, 'Content-Type': type }, body: buf });
    const body = await res.json().catch(() => ({}));
    console.log(`vision RAW body (${Math.round(buf.length / 1024)} KB ${type})\n  ${res.ok ? `${body.decision} | ${body.voice} | ${body.notification} | server ${body.response_time_ms} ms` : `✗ HTTP ${res.status} ${JSON.stringify(body).slice(0, 160)}`} | wall ${Date.now() - t0} ms`);
  }
} else {
  console.log('(set IMAGE=/path/to/screenshot.jpg to exercise the vision lane)');
}
