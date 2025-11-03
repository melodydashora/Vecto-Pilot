/**
 * Simulation: Step 1 workflow logging
 * Contract: snapshot → strategy_row → status=complete → notify → client_renders
 * Output: NDJSON lines to stdout (and optional file if LOG_FILE is set)
 *
 * Philosophy:
 * - Null is a signal; never erase data.
 * - Single-write per stage; stage transitions are explicit.
 * - All events are append-only and auditable.
 */

import fs from 'node:fs';

const LOG_FILE = process.env.LOG_FILE || null;
const SNAPSHOT_ID = process.env.SNAPSHOT_ID || 'sim-0001';
const CLIENT_ID = process.env.CLIENT_ID || 'client-dev';
const DELAY_MS = Number(process.env.SIM_DELAY_MS || 300); // stagger events for realism

// Utility: write NDJSON line
function logEvent(event) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });
  process.stdout.write(line + '\n');
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, line + '\n');
}

// Utility: explicit stage transition
function stageTransition(prev, next) {
  return {
    type: 'stage_transition',
    snapshot_id: SNAPSHOT_ID,
    from: prev,
    to: next,
    integrity: 'single-write',
  };
}

// Utility: sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  // Boot signal: simulation started, environment snapshot
  logEvent({
    type: 'simulation_boot',
    snapshot_id: SNAPSHOT_ID,
    client_id: CLIENT_ID,
    run_mode: 'simulation',
    env_flags: {
      SIMULATE: process.env.SIMULATE === '1',
      LOG_FILE: LOG_FILE ? 'enabled' : 'disabled',
    },
  });

  // 1) Snapshot created
  logEvent({
    type: 'snapshot_created',
    snapshot_id: SNAPSHOT_ID,
    fields: {
      strategy_text: null,          // null as signal: not yet written
      strategy_status: 'pending',   // explicit pending
      notify_emitted: false,
      client_rendered: false,
    },
    contract: 'single-write; never erase',
  });

  await sleep(DELAY_MS);

  // 2) Strategy row written (single-write)
  const STRATEGY_TEXT =
    'Embassy Suites near Stonebriar: stage at valet circle; enter via south atrium. Pro tip: avoid lunch rush 12–1:15.';
  logEvent(stageTransition('snapshot_created', 'strategy_written'));
  logEvent({
    type: 'strategy_written',
    snapshot_id: SNAPSHOT_ID,
    strategy_row: {
      text: STRATEGY_TEXT,
      created_at: new Date().toISOString(),
      source: 'simulated-generator',
    },
    invariants: ['append-only', 'no-rewrites', 'auditable'],
  });

  await sleep(DELAY_MS);

  // 3) Status = complete
  logEvent(stageTransition('strategy_written', 'status_complete'));
  logEvent({
    type: 'status_updated',
    snapshot_id: SNAPSHOT_ID,
    previous_status: 'pending',
    new_status: 'complete',
    guarantee: 'no partials; complete gates notifications',
  });

  await sleep(DELAY_MS);

  // 4) Notify (server emits)
  logEvent(stageTransition('status_complete', 'notify_emitted'));
  logEvent({
    type: 'notify_emitted',
    snapshot_id: SNAPSHOT_ID,
    channel: 'sse',
    event: 'strategy_ready',
    payload: { text: STRATEGY_TEXT },
    contract: 'event-driven; listeners only; no polling required',
  });

  await sleep(DELAY_MS);

  // 5) Client renders strategy text
  logEvent(stageTransition('notify_emitted', 'client_rendered'));
  logEvent({
    type: 'client_rendered',
    snapshot_id: SNAPSHOT_ID,
    client_id: CLIENT_ID,
    render: {
      strategy_text: STRATEGY_TEXT,
      blocks: null, // null: blocks not part of Step 1 minimal contract
    },
    ui_contract: 'explicit rendering; no retries; visible status',
  });

  // Terminal summary
  logEvent({
    type: 'simulation_complete',
    snapshot_id: SNAPSHOT_ID,
    summary: {
      stages: [
        'snapshot_created',
        'strategy_written',
        'status_complete',
        'notify_emitted',
        'client_rendered',
      ],
      integrity: 'all single-write; no erasures; nulls used as signals',
    },
  });
})();
