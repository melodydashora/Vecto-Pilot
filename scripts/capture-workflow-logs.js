#!/usr/bin/env node

/**
 * Workflow Log Capture Script
 * 
 * Captures complete workflow cycle from refresh to smartblocks landing:
 * - Workflow startup/restart events
 * - HTTP requests and responses
 * - Database operations (queries, inserts, updates)
 * - LLM triad pipeline execution
 * - Frontend smartblocks rendering
 * 
 * Output: ./logs/workflow-capture.log (overwrites on each run)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(process.cwd(), 'logs', 'workflow-capture.log');
const CAPTURE_DURATION_MS = 120000; // 2 minutes capture window

// Ensure logs directory exists
if (!fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

// Initialize log file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });

function log(section, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = data 
    ? `[${timestamp}] [${section}] ${message}\n${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] [${section}] ${message}\n`;
  
  logStream.write(logLine);
  console.log(logLine.trim());
}

// Workflow state tracking
let workflowState = {
  started: false,
  strategyGenerated: false,
  blocksReturned: false,
  complete: false
};

log('INIT', '========================================');
log('INIT', 'WORKFLOW LOG CAPTURE STARTED');
log('INIT', '========================================');
log('INIT', `Capture duration: ${CAPTURE_DURATION_MS / 1000}s`);
log('INIT', `Output: ${LOG_FILE}`);

// Patch console methods to capture all logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  
  // Detect workflow events
  if (msg.includes('Eidolon') || msg.includes('gateway') || msg.includes('SDK')) {
    log('WORKFLOW', msg);
  }
  
  // Detect database operations
  if (msg.includes('INSERT') || msg.includes('SELECT') || msg.includes('UPDATE') || msg.includes('DELETE')) {
    log('DATABASE', msg);
  }
  
  // Detect triad pipeline
  if (msg.includes('TRIAD') || msg.includes('Claude') || msg.includes('GPT') || msg.includes('Gemini')) {
    log('TRIAD', msg);
    
    if (msg.includes('Step 1/3')) workflowState.started = true;
    if (msg.includes('strategy received')) workflowState.strategyGenerated = true;
  }
  
  // Detect blocks/smartblocks
  if (msg.includes('BLOCKS') || msg.includes('smartblocks') || msg.includes('blocks') && msg.includes('returned')) {
    log('BLOCKS', msg);
    workflowState.blocksReturned = true;
  }
  
  // Detect HTTP activity
  if (msg.includes('GET /') || msg.includes('POST /') || msg.includes('PATCH /') || msg.includes('DELETE /')) {
    log('HTTP', msg);
  }
  
  originalLog(...args);
};

console.error = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  log('ERROR', msg);
  originalError(...args);
};

console.warn = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  log('WARN', msg);
  originalWarn(...args);
};

// Database operation interceptor
import pg from 'pg';
const { Client } = pg;

const originalQuery = Client.prototype.query;
Client.prototype.query = async function(...args) {
  const queryText = typeof args[0] === 'string' ? args[0] : args[0]?.text || 'unknown';
  const params = args[1] || [];
  
  const queryType = queryText.trim().split(' ')[0].toUpperCase();
  log('DATABASE', `${queryType} Query`, {
    query: queryText.substring(0, 200) + (queryText.length > 200 ? '...' : ''),
    params: params.length > 0 ? `${params.length} params` : 'no params'
  });
  
  const startTime = Date.now();
  try {
    const result = await originalQuery.apply(this, args);
    const duration = Date.now() - startTime;
    log('DATABASE', `${queryType} Result: ${result.rowCount} rows (${duration}ms)`);
    return result;
  } catch (error) {
    log('DATABASE', `${queryType} Error: ${error.message}`);
    throw error;
  }
};

// Status check
function checkWorkflowStatus() {
  const status = {
    started: workflowState.started,
    strategyGenerated: workflowState.strategyGenerated,
    blocksReturned: workflowState.blocksReturned,
    complete: workflowState.strategyGenerated && workflowState.blocksReturned
  };
  
  log('STATUS', 'Workflow State', status);
  
  if (status.complete && !workflowState.complete) {
    workflowState.complete = true;
    log('STATUS', '✅ WORKFLOW CYCLE COMPLETE');
    setTimeout(cleanup, 5000); // Give 5 more seconds for any trailing logs
  }
}

// Check status every 5 seconds
const statusInterval = setInterval(checkWorkflowStatus, 5000);

// Cleanup and exit
function cleanup() {
  clearInterval(statusInterval);
  
  log('INIT', '========================================');
  log('INIT', 'WORKFLOW LOG CAPTURE COMPLETE');
  log('INIT', '========================================');
  log('INIT', `Captured logs written to: ${LOG_FILE}`);
  
  logStream.end(() => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.exit(0);
  });
}

// Auto-cleanup after capture duration
setTimeout(() => {
  log('INIT', 'Capture duration reached, finalizing...');
  cleanup();
}, CAPTURE_DURATION_MS);

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

log('INIT', 'Monitoring started. Waiting for workflow activity...');
