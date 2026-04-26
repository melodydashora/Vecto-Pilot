/**
 * test-tomtom-capture.js
 *
 * Captures the live TomTom traffic-incident response for inspection. Mirrors
 * the snapshot-observer pattern (test-snapshot-workflow.js → snapshot.txt):
 * fetches once, writes a human-readable trace to tomtom.txt at repo root,
 * exits silently. No console output — quiet write per Melody's spec.
 *
 * Why this exists (2026-04-26): the strategy mentioned roads (Dallas North
 * Tollway, Gateway Church) that didn't have triangle markers on the map.
 * Phase F renders incidents only from briefing.traffic_conditions.incidents
 * (the top-10 prioritized subset). TomTom's full response can include 40+
 * incidents per snapshot, plus Gemini has google_search grounding enabled
 * for BRIEFING_TRAFFIC and can add road mentions from web search results.
 * This capture surfaces:
 *   1. What TomTom actually returned (raw incident count)
 *   2. The parsed shape of every incident (road, location, category, coords)
 *   3. Which 10 made it into prioritized list (BRIEFING_TRAFFIC input)
 *   4. Which incidents have coords (would render on Phase F map)
 *   5. Which incidents got dropped between raw and prioritized
 *   6. Keyword audit for arterial roads commonly mentioned in strategy text
 *
 * Usage:
 *   node scripts/test-tomtom-capture.js                  # uses latest snapshot's coords
 *   node scripts/test-tomtom-capture.js 33.158 -96.83    # custom lat/lon
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRawTraffic, getTomTomTraffic } from '../server/lib/traffic/tomtom.js';

const OUTPUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'tomtom.txt'
);

const lines = [];

function out(line = '') { lines.push(line); }

function writeFile() {
  try { fs.writeFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf-8'); }
  catch { /* swallow — best-effort */ }
}

function fmt(val, fallback = 'null') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'number' && !Number.isFinite(val)) return 'NaN';
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return '[unserializable]'; }
  }
  return String(val);
}

function fmtNum(n, decimals = 4) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  return n.toFixed(decimals);
}

function printIncident(inc, index) {
  const cat = String(inc.category || 'Unknown').padEnd(12);
  const sev = String(inc.magnitude || inc.severity || '?').padEnd(8);
  const dist = (typeof inc.distanceFromDriver === 'number')
    ? `${inc.distanceFromDriver}mi`.padStart(7)
    : '   ?  ';
  const delay = (typeof inc.delayMinutes === 'number')
    ? `${inc.delayMinutes}min`.padStart(7)
    : '   ?  ';
  const hwyTag = inc.isHighway ? ' HWY' : '';
  const hasCoords = (typeof inc.incidentLat === 'number' && typeof inc.incidentLon === 'number'
    && Number.isFinite(inc.incidentLat) && Number.isFinite(inc.incidentLon));
  const coords = hasCoords
    ? `[${fmtNum(inc.incidentLat)},${fmtNum(inc.incidentLon)}]`
    : '[NO COORDS]';

  out(`  ${String(index + 1).padStart(2)}. ${cat} ${sev} ${dist} ${delay}${hwyTag}  ${coords}`);
  out(`      road: ${inc.road || '(no road)'}`);
  if (inc.location || inc.from || inc.to) {
    out(`      loc:  ${inc.location || `${inc.from || ''} → ${inc.to || ''}`}`);
  }
}

async function getDefaultCoords() {
  if (!process.env.DATABASE_URL) return null;
  const isProd = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'tomtom-capture',
    ssl: isProd ? { rejectUnauthorized: false } : false,
  });
  try {
    await client.connect();
    const r = await client.query(
      'SELECT lat, lng, city, state FROM snapshots ORDER BY created_at DESC LIMIT 1'
    );
    return r.rows[0] || null;
  } catch { return null; }
  finally { try { await client.end(); } catch {} }
}

async function main() {
  out(`TOMTOM TRAFFIC CAPTURE — ${new Date().toISOString()}`);
  out(`${'═'.repeat(70)}`);

  // ── Resolve coords ────────────────────────────────────────────────────────
  let lat, lon, label;
  if (process.argv[2] && process.argv[3]) {
    lat = parseFloat(process.argv[2]);
    lon = parseFloat(process.argv[3]);
    label = `(custom CLI args: ${lat}, ${lon})`;
  } else {
    const snap = await getDefaultCoords();
    if (!snap || snap.lat == null || snap.lng == null) {
      out('');
      out('ERROR: No coords provided and no usable snapshot in DB');
      writeFile();
      return;
    }
    lat = parseFloat(snap.lat);
    lon = parseFloat(snap.lng);
    label = `${snap.city}, ${snap.state} (latest snapshot)`;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    out('');
    out(`ERROR: Invalid coords (lat=${lat}, lon=${lon})`);
    writeFile();
    return;
  }

  out('');
  out(`LOCATION`);
  out(`${'─'.repeat(70)}`);
  out(`  Coords:  ${lat}, ${lon}`);
  out(`  Source:  ${label}`);

  // ── fetchRawTraffic ───────────────────────────────────────────────────────
  out('');
  out(`RAW TOMTOM RESPONSE  (fetchRawTraffic)`);
  out(`${'─'.repeat(70)}`);
  let raw = null;
  try {
    // fetchRawTraffic(lat, lng, radiusMeters) — note: meters, not miles. 10mi ≈ 16093m.
    raw = await fetchRawTraffic(lat, lon, 16093);
    if (!raw) {
      out('  Returned null — check TOMTOM_API_KEY and bbox validity');
    } else {
      out(`  flow:               ${raw.flow ? 'present' : 'null'}`);
      out(`  incidents (raw):    ${raw.incidents?.length ?? 0}`);
      out(`  bbox:               ${fmt(raw.bbox)}`);
    }
  } catch (err) {
    out(`  ERROR: ${err.message}`);
  }

  // ── getTomTomTraffic (parsed) ─────────────────────────────────────────────
  out('');
  out(`PARSED + PRIORITIZED  (getTomTomTraffic — feeds BRIEFING_TRAFFIC)`);
  out(`${'─'.repeat(70)}`);

  let parsed = null;
  try {
    // getTomTomTraffic takes a destructured options object, not positional args.
    parsed = await getTomTomTraffic({ lat, lon, radiusMiles: 10, maxDistanceMiles: 10 });
  } catch (err) {
    out(`  ERROR during parse: ${err.message}`);
    out(`  Stack: ${err.stack?.split('\n').slice(0, 4).join('\n  ') || ''}`);
  }

  const t = parsed?.traffic ?? null;
  if (!t) {
    out('  No parsed traffic — skipping incident sections');
    writeFile();
    return;
  }

  out(`  totalIncidents:           ${fmt(t.totalIncidents)}`);
  out(`  congestionLevel:          ${fmt(t.congestionLevel)}`);
  out(`  prioritized count:        ${t.incidents?.length ?? 0}  (top 15 by priority for AI input)`);
  out(`  allIncidents count:       ${t.allIncidents?.length ?? 0}  (full deduplicated set)`);
  out(`  stats:                    ${fmt(t.stats)}`);
  out(`  source:                   ${fmt(t.source)}`);
  out(`  city / state:             ${fmt(t.city)} / ${fmt(t.state)}`);

  // ── Coord coverage ────────────────────────────────────────────────────────
  const all = (t.allIncidents && t.allIncidents.length > 0) ? t.allIncidents : (t.incidents ?? []);
  const hasCoord = (i) => typeof i.incidentLat === 'number' && typeof i.incidentLon === 'number'
    && Number.isFinite(i.incidentLat) && Number.isFinite(i.incidentLon);
  const withCoords = all.filter(hasCoord);
  const withoutCoords = all.filter(i => !hasCoord(i));

  out('');
  out(`COORD COVERAGE`);
  out(`${'─'.repeat(70)}`);
  out(`  Total incidents:                 ${all.length}`);
  out(`  Have coords (Phase F plottable): ${withCoords.length}`);
  out(`  Missing coords:                  ${withoutCoords.length}`);
  if (withoutCoords.length > 0) {
    const noCoordCategories = withoutCoords.reduce((acc, i) => {
      const k = i.category || 'Unknown'; acc[k] = (acc[k] || 0) + 1; return acc;
    }, {});
    out(`  No-coord category breakdown:     ${JSON.stringify(noCoordCategories)}`);
  }

  // ── Prioritized top 15 ────────────────────────────────────────────────────
  out('');
  out(`PRIORITIZED TOP-15  (this array is sent to Gemini BRIEFING_TRAFFIC as input)`);
  out(`${'─'.repeat(70)}`);
  out(`  Format:  N. CATEGORY     SEV       DIST    DELAY  HWY  [LAT,LON]`);
  out(`           road:`);
  out(`           loc:`);
  out('');
  if (!t.incidents || t.incidents.length === 0) {
    out('  (no prioritized incidents)');
  } else {
    t.incidents.slice(0, 15).forEach((inc, i) => printIncident(inc, i));
  }

  // ── All incidents (full set, sorted by priority) ──────────────────────────
  out('');
  out(`ALL INCIDENTS — full deduplicated set, sorted by priority`);
  out(`${'─'.repeat(70)}`);
  out(`(Anything below position 15 was dropped before Gemini saw it.)`);
  out('');
  if (all.length === 0) {
    out('  (no incidents)');
  } else {
    all.forEach((inc, i) => {
      printIncident(inc, i);
      if (i === 14 && all.length > 15) {
        out('');
        out(`  --- CUTOFF: incidents below this line are NOT sent to Gemini ---`);
        out('');
      }
    });
  }

  // ── Keyword audit ─────────────────────────────────────────────────────────
  out('');
  out(`KEYWORD AUDIT  (arterial roads commonly mentioned in strategy text)`);
  out(`${'─'.repeat(70)}`);
  const keywords = ['toll', 'DNT', 'I-35', 'I35', 'Dallas Pkwy', 'Frontier', 'Tollway', 'US-75', 'US-380', '635', 'LBJ'];
  for (const kw of keywords) {
    const matches = all.filter(i => {
      const haystack = `${i.road || ''} ${i.location || ''} ${i.from || ''} ${i.to || ''}`.toLowerCase();
      return haystack.includes(kw.toLowerCase());
    });
    if (matches.length > 0) {
      out(`  "${kw}":  ${matches.length} match(es)`);
      matches.forEach((m) => {
        const idx = all.indexOf(m);
        const status = idx < 15 ? 'TOP15      ' : 'FILTERED OUT';
        out(`     [${status}] #${String(idx + 1).padStart(2)}. ${m.category} on ${m.road || '(no road)'} — ${m.location || ''}`);
      });
    }
  }

  out('');
  out(`Capture written: ${OUTPUT_FILE}`);
  writeFile();
}

main()
  .catch(err => {
    out('');
    out(`FATAL: ${err.stack || err.message}`);
    writeFile();
    process.exit(1);
  })
  .then(() => process.exit(0));
