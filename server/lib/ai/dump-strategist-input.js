// 2026-04-26: Capture the EXACT {system, user} payload sent to the strategist
// LLM (STRATEGY_TACTICAL + STRATEGY_DAILY). Writes to strategist-input.txt at
// repo root so we can audit token bloat — i.e., what's actually being sent vs
// what's just sitting in the briefing row.
//
// The existing sent-to-strategist.txt is a verification rollup (snapshot row +
// briefing row + strategy-output row), NOT the LLM input. This file is what
// the model literally receives.

import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_FILE = path.resolve(process.cwd(), 'strategist-input.txt');

// Module-level buffer so successive calls in one snapshot cycle (TACTICAL then
// DAILY) accumulate into the same file rather than overwriting.
let buffer = [];
let bufferSnapshotId = null;

function approxTokens(str) {
  // Rough: 1 token ≈ 4 chars for English. Good enough for sanity-checking bloat.
  return Math.round((str?.length ?? 0) / 4);
}

function divider() {
  return '═'.repeat(80);
}

function section(title) {
  return [divider(), title, divider()].join('\n');
}

/**
 * Capture one strategist LLM call. Call this immediately BEFORE callModel().
 *
 * @param {Object} params
 * @param {string} params.role         - registry role name, e.g. 'STRATEGY_TACTICAL'
 * @param {string} params.snapshotId   - snapshot the strategy is for
 * @param {string} params.system       - system prompt sent to the LLM
 * @param {string} params.user         - user prompt sent to the LLM
 * @param {string} [params.modelName]  - resolved model name if known (optional)
 * @param {Object} [params.extra]      - any other key/value pairs to record
 */
export function captureStrategistInput({ role, snapshotId, system, user, modelName, extra }) {
  // If this is a new snapshot cycle, reset the buffer (overwrites the file)
  if (bufferSnapshotId !== snapshotId) {
    buffer = [];
    bufferSnapshotId = snapshotId;
  }

  const sysTokens = approxTokens(system);
  const userTokens = approxTokens(user);

  buffer.push('');
  buffer.push(section(`STRATEGIST INPUT — role=${role}`));
  buffer.push(`Captured at:    ${new Date().toISOString()}`);
  buffer.push(`Snapshot ID:    ${snapshotId || '(none)'}`);
  buffer.push(`Model role:     ${role}`);
  if (modelName) buffer.push(`Resolved model: ${modelName}`);
  buffer.push(`System chars:   ${(system?.length ?? 0).toLocaleString()}  (~${sysTokens.toLocaleString()} tokens)`);
  buffer.push(`User chars:     ${(user?.length ?? 0).toLocaleString()}  (~${userTokens.toLocaleString()} tokens)`);
  buffer.push(`Total chars:    ${((system?.length ?? 0) + (user?.length ?? 0)).toLocaleString()}  (~${(sysTokens + userTokens).toLocaleString()} tokens)`);
  if (extra && Object.keys(extra).length > 0) {
    buffer.push('');
    buffer.push('Extra metadata:');
    for (const [k, v] of Object.entries(extra)) {
      buffer.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
  buffer.push('');
  buffer.push('--- SYSTEM PROMPT ---');
  buffer.push(system ?? '(empty)');
  buffer.push('');
  buffer.push('--- USER PROMPT ---');
  buffer.push(user ?? '(empty)');
  buffer.push('');

  // Write incrementally so partial captures survive a crash mid-cycle.
  try {
    const header = [
      divider(),
      `STRATEGIST INPUT CAPTURE — Snapshot ${snapshotId}`,
      divider(),
      `Each section below is one LLM call within this snapshot's strategy cycle.`,
      `Token counts are approximate (chars/4); use to spot bloat, not for billing.`,
      '',
    ].join('\n');
    fs.writeFileSync(OUTPUT_FILE, header + buffer.join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[strategist-input-capture] Write failed: ${err.message}`);
  }
}
