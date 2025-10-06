#!/usr/bin/env node
// scripts/hedge-burst-v2.mjs
import http from 'http';

const N = Number(process.argv[2] || 60);
const payload = JSON.stringify({ lat: 33.1507, lng: -96.8236 }); // Frisco, TX

const run = (i) => new Promise((resolve) => {
  const t0 = Date.now();
  const req = http.request({
    hostname: 'localhost', port: 5000, path: '/api/blocks', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': `burst-${i}` }
  }, (res) => {
    let data=''; res.on('data', d => data+=d);
    res.on('end', () => {
      const ms = Date.now()-t0;
      try { const j = JSON.parse(data); console.log(`#${i}: ${j.provider||'?'} ${ms}ms b=${(j.blocks||[]).length}`); }
      catch { console.log(`#${i}: ${res.statusCode} ${ms}ms`); }
      resolve();
    });
  });
  req.on('error', e => { console.log(`#${i}: ERR ${e.message}`); resolve(); });
  req.write(payload); req.end();
});

(async () => { await Promise.all(Array.from({ length: N }, (_, i) => run(i+1))); })();
