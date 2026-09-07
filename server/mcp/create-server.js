// server/mcp/create-server.js
// Builds the Vecto Pilot McpServer: tools + resources, transport-agnostic.
//
// 2026-09-03: Created with the MCP server. One factory so the HTTP entry
// (mcp-server.js), the stdio entry (mcp-server.js --stdio) and the unit tests
// (InMemoryTransport) all get the identical tool surface.

import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContinuityTools } from './continuity-tools.js';
import { registerRepoTools } from './repo-tools.js';

export const SERVER_NAME = 'vecto-pilot';

// Governing documents exposed as MCP resources so a connected session can read
// the constitution and wake-up protocol without a file tool round-trip.
const DOC_RESOURCES = [
  { file: 'CLAUDE.md', title: 'CLAUDE.md — wake-up protocol', description: 'Partnership orientation: principles, hard limits, where facts live.' },
  { file: 'AI_PARTNERSHIP_AGREEMENT.md', title: 'AI Partnership Agreement', description: 'The constitution. Governs when anything conflicts.' },
  { file: 'ARCHITECTURE.md', title: 'ARCHITECTURE.md', description: 'System overview and folder index.' },
];

/** Default per-call audit line on stderr (stdout is the stdio protocol channel). */
export function makeStderrAudit(log = (line) => process.stderr.write(line + '\n')) {
  return function audit(name, fn) {
    return async function auditedTool(args, extra) {
      const started = Date.now();
      const sid = extra && extra.sessionId ? String(extra.sessionId).slice(0, 8) : 'stdio';
      try {
        const result = await fn(args, extra);
        log(`[mcp] tool=${name} ok ms=${Date.now() - started} session=${sid}`);
        return result;
      } catch (err) {
        log(`[mcp] tool=${name} error ms=${Date.now() - started} session=${sid} msg=${JSON.stringify(err && err.message ? err.message : String(err))}`);
        throw err;
      }
    };
  };
}

/**
 * @param {object} options
 * @param {object} options.store         continuity store (createContinuityStore(db) or a test fake)
 * @param {string} options.baseDir       repository root for repo tools
 * @param {string} options.version       server version (package.json version)
 * @param {boolean} [options.readOnly]   when true, no write tools are registered
 * @param {Function} [options.audit]     (name, fn) => fn wrapper; default logs to stderr
 */
export function createVectoMcpServer({ store, baseDir, version, readOnly = false, audit = makeStderrAudit() }) {
  if (!store) throw new Error('createVectoMcpServer: store is required');
  if (!baseDir) throw new Error('createVectoMcpServer: baseDir is required');
  if (!version) throw new Error('createVectoMcpServer: version is required');

  const server = new McpServer(
    { name: SERVER_NAME, version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: [
        'Vecto Pilot continuity server. Start every session with boot_context, then read the CLAUDE.md and AI Partnership Agreement resources.',
        'Continuity tables are additive: rows are never deleted, only added or status-flipped. app_rules is read-only.',
        'Repo tools are read-only. Shell, SQL and file writes are NOT available here by design (they live on the separate agent server).',
        readOnly ? 'This instance is READ-ONLY: no write tools are registered.' : 'Writes stamp metadata.mcp_client with your client name/version for provenance.',
      ].join(' '),
    },
  );

  registerContinuityTools(server, store, { readOnly, audit });
  registerRepoTools(server, { baseDir, audit });

  for (const doc of DOC_RESOURCES) {
    const uri = `vecto://doc/${doc.file}`;
    server.registerResource(doc.file, uri, { title: doc.title, description: doc.description, mimeType: 'text/markdown' }, async () => {
      const text = await fs.readFile(path.join(baseDir, doc.file), 'utf8');
      return { contents: [{ uri, mimeType: 'text/markdown', text }] };
    });
  }

  return server;
}
