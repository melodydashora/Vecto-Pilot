// server/logger/file-tee.js
//
// 2026-04-27: Mirrors console.log/warn/error/debug output to a rotating file
// at logs/server-current.log so it can be read remotely by an authenticated
// log-viewer endpoint. Lets Melody monitor server logs from mobile while
// driving without needing to copy/paste from the Replit terminal.
//
// Behavior:
// - Original console output to stdout/stderr is preserved (terminal still works)
// - Every log line is also appended to logs/server-current.log
// - Auto-rotates: when current log exceeds MAX_BYTES, it's renamed to
//   logs/server-prev.log (overwriting any existing prev) and a fresh current
//   log is started. So at most 2x MAX_BYTES of disk used.
// - Defensive: never throws from the patched console methods

import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server-current.log');
const PREV_LOG_FILE = path.join(LOG_DIR, 'server-prev.log');
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per file; ~20MB total disk

let stream = null;
let bytesWritten = 0;
let installed = false;

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }
}

function rotate() {
  try {
    if (stream) { stream.end(); stream = null; }
    if (fs.existsSync(LOG_FILE)) {
      try { fs.renameSync(LOG_FILE, PREV_LOG_FILE); } catch { /* best-effort */ }
    }
  } catch { /* ignore */ }
  stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  stream.on('error', () => { /* never throw */ });
  bytesWritten = 0;
}

function writeToFile(level, args) {
  if (!stream) return;
  if (bytesWritten >= MAX_BYTES) rotate();
  try {
    const ts = new Date().toISOString();
    const msg = format(...args);
    const out = `${ts} ${level.padEnd(5)} ${msg}\n`;
    stream.write(out);
    bytesWritten += Buffer.byteLength(out);
  } catch { /* never throw from logger */ }
}

/**
 * Install the console-tee. Idempotent — calling twice is a no-op.
 * Call BEFORE any meaningful console output to capture the full session.
 */
export function installFileTee() {
  if (installed) return;
  installed = true;

  ensureLogDir();
  rotate();

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origDebug = console.debug ? console.debug.bind(console) : origLog;
  const origInfo = console.info ? console.info.bind(console) : origLog;

  console.log = (...args) => { origLog(...args); writeToFile('INFO', args); };
  console.info = (...args) => { origInfo(...args); writeToFile('INFO', args); };
  console.warn = (...args) => { origWarn(...args); writeToFile('WARN', args); };
  console.error = (...args) => { origError(...args); writeToFile('ERROR', args); };
  console.debug = (...args) => { origDebug(...args); writeToFile('DEBUG', args); };

  // Boot marker so the user knows the file rotated
  writeToFile('INFO', [`[BOOT] file-tee installed (rotation at ${MAX_BYTES} bytes)`]);
}

/** Test/diagnostic helper — exposed for the API endpoint to introspect. */
export function getLogFilePaths() {
  return { current: LOG_FILE, prev: PREV_LOG_FILE, dir: LOG_DIR, maxBytes: MAX_BYTES };
}
